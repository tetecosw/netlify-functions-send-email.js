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
    const data = JSON.parse(event.body);
    const { pedidoId, cliente, total } = data;

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });

    const mailOptions = {
      from: `"Skincare Pro Store" <${process.env.GMAIL_USER}>`,
      to: cliente.email,
      subject: `Pedido Confirmado! #${pedidoId}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 20px;">
          <h2 style="color: #e11d48;">Olá, ${cliente.nome}!</h2>
          <p>Seu pagamento foi aprovado com sucesso. Estamos preparando seu pedido para envio.</p>
          <hr style="border: 0; border-top: 1px solid #eee;">
          <p><strong>Resumo do Pedido:</strong></p>
          <p>ID do Pedido: #${pedidoId}</p>
          <p>Valor Total: R$ ${total.toFixed(2).replace('.', ',')}</p>
          <p><strong>Prazo de Entrega:</strong> 2 a 3 dias úteis.</p>
          <hr style="border: 0; border-top: 1px solid #eee;">
          <p style="font-size: 12px; color: #666;">Se tiver dúvidas, responda a este e-mail ou nos chame no WhatsApp.</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: "E-mail enviado com sucesso!" }),
    };
  } catch (error) {
    console.error("Erro ao enviar e-mail:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Falha no envio do e-mail", details: error.message }),
    };
  }
};
