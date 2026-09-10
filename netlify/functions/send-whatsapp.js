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

    if (!cliente?.telefone) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Telefone ausente" }) };
    }

    // Limpeza e formatação do telefone
    const telefone = cliente.telefone.replace(/\D/g, "");
    const telefoneFinal = telefone.startsWith("55") ? telefone : "55" + telefone;

    const TOKEN = process.env.WHATSAPP_TOKEN;
    const PHONE_ID = process.env.WHATSAPP_PHONE_ID;

    const mensagem = `✅ *Pedido Confirmado!*
    
*Skincare Pro Store*
Pedido: #${pedidoId}

Olá ${cliente.nome}, seu pagamento foi aprovado! 
Estamos preparando seus produtos.

*Total: R$ ${total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}*

📦 Prazo: 2-3 dias úteis.
🧾 Nota fiscal inclusa.

Dúvidas? Responda aqui ou ligue (31) 98481-5086.`;

    const response = await fetch(`https://graph.facebook.com/v18.0/${PHONE_ID}/messages`, {
      method: "POST",
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: telefoneFinal,
        type: "text",
        text: { body: mensagem },
      }),
    });

    const result = await response.json();

    if (!response.ok) throw new Error(result.error?.message || "Erro na API do WhatsApp");

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, waId: result.messages?.[0]?.id }),
    };
  } catch (error) {
    console.error("Erro WhatsApp:", error.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
