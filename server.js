const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const cron = require("node-cron");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const db = new Database("international.db");
db.pragma("journal_mode = WAL");

app.use(express.json({limit:"1mb"}));
app.use(express.urlencoded({extended:true}));
app.use(session({
  secret: process.env.SESSION_SECRET || "international-local-dev-secret",
  resave:false,
  saveUninitialized:false,
  cookie:{httpOnly:true,sameSite:"lax",maxAge:1000*60*60*12}
}));
app.use(express.static(path.join(__dirname,"public")));

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id=1),
  store_name TEXT NOT NULL DEFAULT 'International',
  store_subtitle TEXT NOT NULL DEFAULT 'Qualidade, preço e atendimento',
  whatsapp TEXT DEFAULT '',
  pix_key TEXT DEFAULT '',
  delivery_text TEXT DEFAULT 'Consulte taxa e região de entrega',
  hero_title TEXT DEFAULT 'Os melhores produtos em um só lugar',
  hero_text TEXT DEFAULT 'Compre com praticidade e fale direto com a nossa equipe.',
  admin_user TEXT NOT NULL DEFAULT 'admin',
  admin_password_hash TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT DEFAULT '',
  description TEXT DEFAULT '',
  image_url TEXT DEFAULT '',
  sku TEXT DEFAULT '',
  cost REAL NOT NULL DEFAULT 0,
  price REAL NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  min_stock INTEGER NOT NULL DEFAULT 2,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER,
  payment_method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  due_date TEXT,
  total REAL NOT NULL DEFAULT 0,
  profit REAL NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  source TEXT DEFAULT 'store',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at TEXT,
  reminder_two_days_sent INTEGER NOT NULL DEFAULT 0,
  reminder_due_day_sent INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  unit_cost REAL NOT NULL,
  FOREIGN KEY(order_id) REFERENCES orders(id)
);
`);

let settings = db.prepare("SELECT * FROM settings WHERE id=1").get();
if (!settings) {
  const user = process.env.ADMIN_USER || "internacional";
  const pass = process.env.ADMIN_PASSWORD || "pods0507";
  const hash = bcrypt.hashSync(pass,10);
  db.prepare(`INSERT INTO settings
    (id,store_name,store_subtitle,admin_user,admin_password_hash)
    VALUES (1,'International','Qualidade, preço e atendimento',?,?)`).run(user,hash);
} else if (!settings.admin_password_hash) {
  const user = process.env.ADMIN_USER || settings.admin_user || "admin";
  const pass = process.env.ADMIN_PASSWORD || "troque-esta-senha";
  db.prepare("UPDATE settings SET admin_user=?, admin_password_hash=? WHERE id=1")
    .run(user,bcrypt.hashSync(pass,10));
}

const adminOnly = (req,res,next)=>{
  if(req.session?.admin) return next();
  res.status(401).json({error:"Acesso de administrador necessário."});
};

const currency = n => Number(n || 0);

app.get("/api/store", (req,res)=>{
  const s = db.prepare(`
    SELECT store_name,store_subtitle,whatsapp,pix_key,delivery_text,hero_title,hero_text
    FROM settings WHERE id=1
  `).get();
  const products = db.prepare(`
    SELECT id,name,category,description,image_url,price,stock
    FROM products WHERE active=1 AND stock>0 ORDER BY id DESC
  `).all();
  res.json({settings:s,products});
});

app.post("/api/orders", (req,res)=>{
  const {name,phone,payment_method,due_date=null,notes="",items=[]} = req.body;
  if(!name || !phone || !payment_method || !Array.isArray(items) || !items.length)
    return res.status(400).json({error:"Preencha seus dados, pagamento e carrinho."});

  if(payment_method==="credit" && !due_date)
    return res.status(400).json({error:"Informe a data combinada para pagamento."});

  const create = db.transaction(()=>{
    const customer = db.prepare("INSERT INTO customers (name,phone) VALUES (?,?)").run(name,phone);
    let total=0, profit=0;
    const normalized=[];

    for(const item of items){
      const p = db.prepare("SELECT * FROM products WHERE id=? AND active=1").get(item.product_id);
      if(!p) throw new Error("Um produto do carrinho não está mais disponível.");
      const qty = Number(item.quantity);
      if(!Number.isInteger(qty) || qty<1) throw new Error("Quantidade inválida.");
      if(p.stock < qty) throw new Error(`Estoque insuficiente para ${p.name}.`);
      total += p.price * qty;
      profit += (p.price-p.cost)*qty;
      normalized.push({p,qty});
    }

    const initialStatus = payment_method==="credit" ? "credit" : "pending";
    const order = db.prepare(`
      INSERT INTO orders(customer_id,payment_method,status,due_date,total,profit,notes,source)
      VALUES(?,?,?,?,?,?,?,'store')
    `).run(customer.lastInsertRowid,payment_method,initialStatus,due_date||null,total,profit,notes);

    for(const {p,qty} of normalized){
      db.prepare(`
        INSERT INTO order_items(order_id,product_id,product_name,quantity,unit_price,unit_cost)
        VALUES(?,?,?,?,?,?)
      `).run(order.lastInsertRowid,p.id,p.name,qty,p.price,p.cost);
      db.prepare("UPDATE products SET stock=stock-? WHERE id=?").run(qty,p.id);
    }

    return {id:order.lastInsertRowid,total,status:initialStatus};
  });

  try{
    const result=create();
    const s=db.prepare("SELECT whatsapp,pix_key FROM settings WHERE id=1").get();
    res.json({...result,whatsapp:s.whatsapp,pix_key:s.pix_key});
  }catch(e){
    res.status(400).json({error:e.message});
  }
});

app.post("/api/admin/login",(req,res)=>{
  const {user,password}=req.body;
  const s=db.prepare("SELECT admin_user,admin_password_hash FROM settings WHERE id=1").get();
  if(user===s.admin_user && bcrypt.compareSync(password||"",s.admin_password_hash)){
    req.session.admin=true;
    return res.json({ok:true});
  }
  res.status(401).json({error:"Usuário ou senha incorretos."});
});

app.post("/api/admin/logout",adminOnly,(req,res)=>{
  req.session.destroy(()=>res.json({ok:true}));
});

app.get("/api/admin/me",(req,res)=>{
  res.json({authenticated:!!req.session?.admin});
});

app.get("/api/admin/dashboard",adminOnly,(req,res)=>{
  const summary=db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN status='paid' THEN total ELSE 0 END),0) revenue,
      COALESCE(SUM(CASE WHEN status='paid' THEN profit ELSE 0 END),0) profit,
      COALESCE(SUM(CASE WHEN status='credit' THEN total ELSE 0 END),0) receivable,
      COUNT(*) orders_count
    FROM orders
  `).get();
  const lowStock=db.prepare("SELECT COUNT(*) n FROM products WHERE active=1 AND stock<=min_stock").get().n;
  const recent=db.prepare(`
    SELECT o.*,c.name customer_name,c.phone customer_phone
    FROM orders o LEFT JOIN customers c ON c.id=o.customer_id
    ORDER BY o.id DESC LIMIT 8
  `).all();
  res.json({...summary,lowStock,recent});
});

app.get("/api/admin/products",adminOnly,(req,res)=>{
  res.json(db.prepare("SELECT * FROM products ORDER BY id DESC").all());
});

app.post("/api/admin/products",adminOnly,(req,res)=>{
  const p=req.body;
  if(!p.name) return res.status(400).json({error:"Nome obrigatório."});
  const info=db.prepare(`
    INSERT INTO products(name,category,description,image_url,sku,cost,price,stock,min_stock,active)
    VALUES(?,?,?,?,?,?,?,?,?,?)
  `).run(
    p.name,p.category||"",p.description||"",p.image_url||"",p.sku||"",
    currency(p.cost),currency(p.price),Number(p.stock||0),Number(p.min_stock||2),p.active===false?0:1
  );
  res.json({id:info.lastInsertRowid});
});

app.put("/api/admin/products/:id",adminOnly,(req,res)=>{
  const p=req.body;
  db.prepare(`
    UPDATE products SET name=?,category=?,description=?,image_url=?,sku=?,cost=?,price=?,stock=?,min_stock=?,active=?
    WHERE id=?
  `).run(
    p.name,p.category||"",p.description||"",p.image_url||"",p.sku||"",
    currency(p.cost),currency(p.price),Number(p.stock||0),Number(p.min_stock||2),p.active?1:0,req.params.id
  );
  res.json({ok:true});
});

app.get("/api/admin/orders",adminOnly,(req,res)=>{
  res.json(db.prepare(`
    SELECT o.*,c.name customer_name,c.phone customer_phone
    FROM orders o LEFT JOIN customers c ON c.id=o.customer_id
    ORDER BY o.id DESC
  `).all());
});

app.get("/api/admin/orders/:id/items",adminOnly,(req,res)=>{
  res.json(db.prepare("SELECT * FROM order_items WHERE order_id=?").all(req.params.id));
});

app.post("/api/admin/orders/:id/status",adminOnly,(req,res)=>{
  const {status}=req.body;
  const allowed=["pending","paid","credit","cancelled"];
  if(!allowed.includes(status)) return res.status(400).json({error:"Status inválido."});
  db.prepare("UPDATE orders SET status=?, paid_at=? WHERE id=?")
    .run(status,status==="paid"?new Date().toISOString():null,req.params.id);
  res.json({ok:true});
});

app.get("/api/admin/settings",adminOnly,(req,res)=>{
  const s=db.prepare(`
    SELECT store_name,store_subtitle,whatsapp,pix_key,delivery_text,hero_title,hero_text,admin_user
    FROM settings WHERE id=1
  `).get();
  res.json(s);
});

app.put("/api/admin/settings",adminOnly,(req,res)=>{
  const s=req.body;
  db.prepare(`
    UPDATE settings SET store_name=?,store_subtitle=?,whatsapp=?,pix_key=?,delivery_text=?,hero_title=?,hero_text=?
    WHERE id=1
  `).run(
    s.store_name||"International",s.store_subtitle||"",s.whatsapp||"",s.pix_key||"",
    s.delivery_text||"",s.hero_title||"",s.hero_text||""
  );
  res.json({ok:true});
});

app.put("/api/admin/password",adminOnly,(req,res)=>{
  const {user,current_password,new_password}=req.body;
  const s=db.prepare("SELECT * FROM settings WHERE id=1").get();
  if(!bcrypt.compareSync(current_password||"",s.admin_password_hash))
    return res.status(400).json({error:"Senha atual incorreta."});
  if(!new_password || new_password.length<6)
    return res.status(400).json({error:"A nova senha precisa ter pelo menos 6 caracteres."});
  db.prepare("UPDATE settings SET admin_user=?,admin_password_hash=? WHERE id=1")
    .run(user||s.admin_user,bcrypt.hashSync(new_password,10));
  res.json({ok:true});
});

function brazilDateISO(date=new Date()){
  return new Intl.DateTimeFormat("en-CA",{
    timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"
  }).format(date);
}
function addDaysISO(iso,days){
  const [y,m,d]=iso.split("-").map(Number);
  const dt=new Date(Date.UTC(y,m-1,d));
  dt.setUTCDate(dt.getUTCDate()+days);
  return dt.toISOString().slice(0,10);
}
async function sendWhatsApp(phone,body){
  const token=process.env.WHATSAPP_TOKEN;
  const phoneNumberId=process.env.WHATSAPP_PHONE_NUMBER_ID;
  const version=process.env.WHATSAPP_API_VERSION||"v23.0";
  if(!token||!phoneNumberId||!phone){
    console.log("[WhatsApp não configurado]",phone,body);
    return false;
  }
  const response=await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`,{
    method:"POST",
    headers:{"Authorization":`Bearer ${token}`,"Content-Type":"application/json"},
    body:JSON.stringify({
      messaging_product:"whatsapp",
      to:String(phone).replace(/\D/g,""),
      type:"text",
      text:{body}
    })
  });
  if(!response.ok){console.error(await response.text());return false}
  return true;
}
async function processCreditReminders(){
  const today=brazilDateISO();
  const two=addDaysISO(today,2);
  const credits=db.prepare(`
    SELECT o.*,c.name customer_name,c.phone customer_phone
    FROM orders o JOIN customers c ON c.id=o.customer_id
    WHERE o.status='credit' AND o.due_date IS NOT NULL
  `).all();
  for(const o of credits){
    if(o.due_date===two && !o.reminder_two_days_sent){
      const ok=await sendWhatsApp(o.customer_phone,
        `Olá, ${o.customer_name}! Seu pagamento de R$ ${o.total.toFixed(2).replace(".",",")} vence em 2 dias (${o.due_date}). — International`);
      if(ok) db.prepare("UPDATE orders SET reminder_two_days_sent=1 WHERE id=?").run(o.id);
    }
    if(o.due_date===today && !o.reminder_due_day_sent){
      const ok=await sendWhatsApp(o.customer_phone,
        `Olá, ${o.customer_name}! Hoje é o vencimento do seu pagamento de R$ ${o.total.toFixed(2).replace(".",",")}. — International`);
      if(ok) db.prepare("UPDATE orders SET reminder_due_day_sent=1 WHERE id=?").run(o.id);
    }
  }
}
cron.schedule("0 9 * * *",processCreditReminders,{timezone:"America/Sao_Paulo"});

app.listen(PORT,()=>console.log(`International Loja Oficial: http://localhost:${PORT}`));
