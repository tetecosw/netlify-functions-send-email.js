const nodemailer = require("nodemailer");

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: "Método não permitido" };

  try {
    const pedido = JSON.parse(event.body);
    const { pedidoId, cliente, total } = pedido;

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });

    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e11d48; border-radius: 12px; overflow: hidden;">
        <div style="background: #e11d48; color: white; padding: 20px; text-align: center;">
          <h1 style="margin: 0; font-size: 20px;">🔔 Novo Pedido Recebido!</h1>
        </div>
        <div style="padding: 20px; color: #333;">
          <p><strong>ID do Pedido:</strong> #${pedidoId}</p>
          <p><strong>Valor Total:</strong> R$ ${total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</p>
          <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
          <p><strong>Dados do Cliente:</strong></p>
          <p>Nome: ${cliente.nome}</p>
          <p>E-mail: ${cliente.email}</p>
          <p>WhatsApp: ${cliente.telefone || 'Não informado'}</p>
          <div style="background: #fffbeb; padding: 15px; border-radius: 8px; margin-top: 20px; border: 1px solid #fde68a;">
            <p style="margin: 0; color: #92400e; font-size: 14px;">
              <strong>Ação Necessária:</strong> Verifique o pagamento no painel do Mercado Pago e prepare o envio.
            </p>
          </div>
        </div>
      </div>
    `;

    await transporter.sendMail({
      from: `"Skincare Pro Store" <${process.env.GMAIL_USER}>`,
      to: process.env.GMAIL_USER, // Envia para você mesmo
      subject: `🔔 Novo Pedido #${pedidoId} - ${cliente.nome}`,
      html,
      replyTo: cliente.email
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true }),
    };
  } catch (error) {
    console.error("Erro notify-store:", error.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
