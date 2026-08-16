# International — Loja Oficial + Administração

Este projeto é um único site com duas áreas:

## 1. Loja dos clientes
A página inicial é pública e mostra somente:
- produtos disponíveis;
- fotos, descrições e preços;
- carrinho;
- Pix, cartão, dinheiro ou pagar depois;
- contato com a loja pelo WhatsApp.

Clientes NÃO veem:
- custo dos produtos;
- lucro;
- estoque mínimo;
- outros clientes;
- lista de fiados;
- configurações internas.

## 2. Área do administrador
Clique em **Administrador** no topo da loja.

No primeiro uso, configure `.env` usando `.env.example`.

Exemplo:
```env
ADMIN_USER=admin
ADMIN_PASSWORD=uma-senha-forte
SESSION_SECRET=uma-chave-secreta-grande
```

No painel você pode:
- acompanhar faturamento e lucro;
- cadastrar estoque;
- ver pedidos;
- controlar fiados;
- configurar chave Pix e WhatsApp;
- personalizar nome e textos da loja;
- trocar usuário e senha do administrador.

## Instalação

Instale Node.js e rode:

```bash
npm install
npm start
```

Depois acesse:
`http://localhost:3000`

IMPORTANTE: abra pelo endereço acima. Não abra o arquivo `index.html` diretamente pelo gerenciador de arquivos do celular, porque assim o servidor, banco de dados e recursos do sistema não funcionam corretamente.

## Cartão
Esta versão registra "Cartão" como forma escolhida pelo cliente. Para cobrar cartão diretamente dentro do site é necessário integrar um gateway de pagamento (por exemplo, Mercado Pago, PagBank etc.).

## WhatsApp automático de fiado
O sistema possui a lógica de lembrete 2 dias antes e no dia do vencimento. Para envio automático real, configure a WhatsApp Cloud API no `.env` e mantenha o site hospedado online 24 horas.