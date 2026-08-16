const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const money=n=>Number(n||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
let storeData={settings:{},products:[]}, cart=[];

async function api(url,opts={}){
  const r=await fetch(url,{headers:{"Content-Type":"application/json"},...opts});
  const data=await r.json();
  if(!r.ok) throw new Error(data.error||"Erro");
  return data;
}
function toast(msg){const t=$("#toast");t.textContent=msg;t.style.display="block";setTimeout(()=>t.style.display="none",2500)}
function openModal(id){$("#"+id).classList.add("open")}
function closeModal(id){$("#"+id).classList.remove("open")}
$$("[data-close]").forEach(b=>b.onclick=()=>closeModal(b.dataset.close));

async function loadStore(){
  storeData=await api("/api/store");
  const s=storeData.settings;
  $("#storeName").textContent=s.store_name||"International";
  $("#storeSubtitle").textContent=s.store_subtitle||"";
  $("#heroTitle").textContent=s.hero_title||"Os melhores produtos em um só lugar";
  $("#heroText").textContent=s.hero_text||"";
  $("#deliveryText").textContent=s.delivery_text||"";
  const wa=String(s.whatsapp||"").replace(/\D/g,"");
  $("#whatsappHero").href=wa?`https://wa.me/${wa}`:"#";
  renderProducts();
}
function renderProducts(){
  const q=$("#search").value.toLowerCase().trim();
  const items=storeData.products.filter(p=>`${p.name} ${p.category} ${p.description}`.toLowerCase().includes(q));
  $("#productGrid").innerHTML=items.length?items.map(p=>`
    <article class="productCard">
      <div class="productImage">${p.image_url?`<img src="${esc(p.image_url)}" alt="${esc(p.name)}">`:`<div class="productPlaceholder">◆</div>`}</div>
      <div class="productBody">
        <span class="cat">${esc(p.category||"Produto")}</span>
        <h3>${esc(p.name)}</h3>
        <p>${esc(p.description||"Disponível para pedido.")}</p>
        <div class="priceRow"><strong class="price">${money(p.price)}</strong><span class="stockText">${p.stock} disponível(is)</span></div>
        <button class="primary addBtn" onclick="addCart(${p.id})">Adicionar ao carrinho</button>
      </div>
    </article>`).join(""):`<p class="muted">Nenhum produto disponível no momento.</p>`;
}
function esc(v){return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
$("#search").oninput=renderProducts;
window.addCart=id=>{
  const p=storeData.products.find(x=>x.id===id); if(!p)return;
  const item=cart.find(x=>x.product_id===id);
  if(item){if(item.quantity<p.stock)item.quantity++}else cart.push({product_id:id,quantity:1});
  renderCart();toast("Adicionado ao carrinho.");
};
function renderCart(){
  $("#cartCount").textContent=cart.reduce((a,b)=>a+b.quantity,0);
  let total=0;
  $("#cartItems").innerHTML=cart.length?cart.map((i,n)=>{
    const p=storeData.products.find(x=>x.id===i.product_id); if(!p)return"";
    total+=p.price*i.quantity;
    return `<div class="cartLine"><div><strong>${esc(p.name)}</strong><small>${money(p.price)} cada</small></div><div class="qtyBtns"><button onclick="qty(${n},-1)">−</button><span>${i.quantity}</span><button onclick="qty(${n},1)">+</button></div></div>`;
  }).join(""):`<p class="muted">Seu carrinho está vazio.</p>`;
  $("#cartTotal").textContent=money(total);$("#checkoutTotal").textContent=money(total);
}
window.qty=(n,d)=>{
  const i=cart[n],p=storeData.products.find(x=>x.id===i.product_id);
  i.quantity+=d;if(i.quantity<=0)cart.splice(n,1);else if(i.quantity>p.stock)i.quantity=p.stock;renderCart()
};
$("#cartOpen").onclick=()=>$("#cartDrawer").classList.add("open");
$("#cartClose").onclick=()=>$("#cartDrawer").classList.remove("open");
$("#checkoutOpen").onclick=()=>{if(!cart.length)return toast("Seu carrinho está vazio.");$("#cartDrawer").classList.remove("open");openModal("checkoutModal")};
$("#paymentMethod").onchange=()=>$("#dueWrap").classList.toggle("hidden",$("#paymentMethod").value!=="credit");

$("#placeOrder").onclick=async()=>{
  try{
    const body={name:$("#customerName").value.trim(),phone:$("#customerPhone").value.trim(),payment_method:$("#paymentMethod").value,due_date:$("#paymentMethod").value==="credit"?$("#dueDate").value:null,notes:$("#orderNotes").value.trim(),items:cart};
    const result=await api("/api/orders",{method:"POST",body:JSON.stringify(body)});
    closeModal("checkoutModal");
    $("#successText").textContent=`Pedido #${result.id} registrado no valor de ${money(result.total)}.`;
    const pix=$("#pixBox");
    if(body.payment_method==="pix"&&result.pix_key){pix.innerHTML=`<strong>Chave Pix</strong><br>${esc(result.pix_key)}`;pix.classList.remove("hidden")}else pix.classList.add("hidden");
    const wa=String(result.whatsapp||"").replace(/\D/g,"");
    const msg=encodeURIComponent(`Olá! Acabei de fazer o pedido #${result.id} no site da International. Total: ${money(result.total)}.`);
    $("#successWhatsapp").href=wa?`https://wa.me/${wa}?text=${msg}`:"#";
    cart=[];renderCart();await loadStore();openModal("successModal");
  }catch(e){toast(e.message)}
};

$("#adminOpen").onclick=async()=>{
  const me=await api("/api/admin/me");
  if(me.authenticated)showAdmin();else openModal("adminLoginModal");
};
$("#loginBtn").onclick=async()=>{
  $("#loginError").textContent="";
  try{
    await api("/api/admin/login",{method:"POST",body:JSON.stringify({user:$("#adminUser").value,password:$("#adminPassword").value})});
    closeModal("adminLoginModal");showAdmin();
  }catch(e){$("#loginError").textContent=e.message}
};
async function showAdmin(){
  $("#storeView").classList.add("hidden");$("#adminView").classList.remove("hidden");await refreshAdmin();
}
$("#backStore").onclick=()=>{$("#adminView").classList.add("hidden");$("#storeView").classList.remove("hidden");loadStore()};
$("#logoutBtn").onclick=async()=>{await api("/api/admin/logout",{method:"POST"});$("#adminView").classList.add("hidden");$("#storeView").classList.remove("hidden");toast("Sessão encerrada.")};

$$(".side[data-page]").forEach(b=>b.onclick=async()=>{
  $$(".side[data-page],.adminPage").forEach(x=>x.classList.remove("active"));
  b.classList.add("active");$("#"+b.dataset.page).classList.add("active");
  $("#adminTitle").textContent=b.querySelector("span").textContent;await refreshAdmin();
});

async function refreshAdmin(){
  const dash=await api("/api/admin/dashboard");
  $("#statRevenue").textContent=money(dash.revenue);$("#statProfit").textContent=money(dash.profit);$("#statReceivable").textContent=money(dash.receivable);$("#statLow").textContent=dash.lowStock;
  $("#recentOrders").innerHTML=orderTable(dash.recent);

  const products=await api("/api/admin/products");
  $("#adminProductList").innerHTML=products.length?`<table><tr><th>Produto</th><th>Custo</th><th>Venda</th><th>Estoque</th><th>Status</th></tr>${products.map(p=>`<tr><td>${esc(p.name)}</td><td>${money(p.cost)}</td><td>${money(p.price)}</td><td>${p.stock}</td><td>${p.active?"Ativo":"Oculto"}</td></tr>`).join("")}</table>`:`<p class="muted">Nenhum produto cadastrado.</p>`;

  const orders=await api("/api/admin/orders");
  $("#orderList").innerHTML=orderTable(orders,true);
  $("#creditList").innerHTML=orderTable(orders.filter(o=>o.status==="credit"),true);

  const s=await api("/api/admin/settings");
  $("#sName").value=s.store_name||"";$("#sSubtitle").value=s.store_subtitle||"";$("#sWhatsapp").value=s.whatsapp||"";$("#sPix").value=s.pix_key||"";$("#sDelivery").value=s.delivery_text||"";$("#sHeroTitle").value=s.hero_title||"";$("#sHeroText").value=s.hero_text||"";$("#newAdminUser").value=s.admin_user||"";
}
function orderTable(rows,actions=false){
  if(!rows?.length)return'<p class="muted">Nenhum registro.</p>';
  return `<table><tr><th>Pedido</th><th>Cliente</th><th>Pagamento</th><th>Total</th><th>Status</th><th>Data</th>${actions?"<th>Ação</th>":""}</tr>${rows.map(o=>`<tr><td>#${o.id}</td><td>${esc(o.customer_name||"-")}<br><small>${esc(o.customer_phone||"")}</small></td><td>${payLabel(o.payment_method)}</td><td>${money(o.total)}</td><td><span class="pill ${o.status}">${statusLabel(o.status)}</span></td><td>${new Date(o.created_at+"Z").toLocaleDateString("pt-BR")}${o.due_date?`<br><small>Vence: ${o.due_date}</small>`:""}</td>${actions?`<td><select onchange="setStatus(${o.id},this.value)"><option value="">Alterar</option><option value="paid">Pago</option><option value="pending">Pendente</option><option value="credit">Fiado</option><option value="cancelled">Cancelar</option></select></td>`:""}</tr>`).join("")}</table>`;
}
function payLabel(x){return({pix:"Pix",card:"Cartão",cash:"Dinheiro",credit:"Pagar depois"})[x]||x}
function statusLabel(x){return({paid:"Pago",pending:"Pendente",credit:"Fiado",cancelled:"Cancelado"})[x]||x}
window.setStatus=async(id,status)=>{if(!status)return;await api(`/api/admin/orders/${id}/status`,{method:"POST",body:JSON.stringify({status})});toast("Status atualizado.");refreshAdmin()};

$("#addProductBtn").onclick=async()=>{
  try{
    await api("/api/admin/products",{method:"POST",body:JSON.stringify({
      name:$("#pName").value,category:$("#pCategory").value,sku:$("#pSku").value,cost:$("#pCost").value,price:$("#pPrice").value,stock:$("#pStock").value,min_stock:$("#pMin").value,image_url:$("#pImage").value,description:$("#pDescription").value,active:true
    })});
    ["pName","pCategory","pSku","pCost","pPrice","pStock","pImage","pDescription"].forEach(id=>$("#"+id).value="");$("#pMin").value=2;toast("Produto cadastrado.");await refreshAdmin();await loadStore();
  }catch(e){toast(e.message)}
};
$("#saveSettings").onclick=async()=>{
  await api("/api/admin/settings",{method:"PUT",body:JSON.stringify({
    store_name:$("#sName").value,store_subtitle:$("#sSubtitle").value,whatsapp:$("#sWhatsapp").value,pix_key:$("#sPix").value,delivery_text:$("#sDelivery").value,hero_title:$("#sHeroTitle").value,hero_text:$("#sHeroText").value
  })});toast("Configurações salvas.");await loadStore();
};
$("#changePassword").onclick=async()=>{
  try{
    await api("/api/admin/password",{method:"PUT",body:JSON.stringify({user:$("#newAdminUser").value,current_password:$("#currentPassword").value,new_password:$("#newPassword").value})});
    $("#currentPassword").value="";$("#newPassword").value="";toast("Usuário e senha alterados.");
  }catch(e){toast(e.message)}
};

loadStore();renderCart();