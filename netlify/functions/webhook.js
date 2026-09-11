const { getStore } = require('@netlify/blobs');
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body);
    
    // O Mercado Pago envia notificações de diversos tipos. Filtramos apenas 'payment'.
    if (body.type === 'payment' || body.topic === 'payment') {
      const paymentId = body.data?.id || body.resource?.split('/').pop();
      
      if (!paymentId) return { statusCode: 200, body: 'No ID found' };

      // Busca os detalhes reais do pagamento para evitar fraudes
      const payResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { 'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}` }
      });

      if (!payResponse.ok) throw new Error('Falha ao validar pagamento no Mercado Pago');
      
      const payment = await payResponse.json();
      const { status, external_reference, transaction_amount, payer, payment_method_id } = payment;

      console.log(`Pedido: ${external_reference} | Status: ${status}`);

      if (status === 'approved') {
      const store = getStore('orders');

await store.set(
  external_reference,
  JSON.stringify({
    order_id: external_reference,
    status: 'approved',
    amount: transaction_amount,
    currency: 'BRL',
    items: payment.additional_info?.items || [],
    created_at: payment.date_created,
    paid_at: payment.date_approved
  })
);  
const payload = {
          pedidoId: external_reference,
          cliente: {
            nome: payer?.first_name || 'Cliente',
            email: payer?.email,
            telefone: payer?.phone?.number || ''
          },
          total: transaction_amount,
          metodo: payment_method_id
        };

        // Dispara notificações em paralelo para ganhar velocidade
        // IMPORTANTE: Essas funções precisam existir no seu projeto!
        const baseUrl = process.env.URL || ''; 
        
        await Promise.allSettled([
          fetch(`${baseUrl}/.netlify/functions/send-email`, { method: 'POST', body: JSON.stringify(payload) }),
          fetch(`${baseUrl}/.netlify/functions/send-whatsapp`, { method: 'POST', body: JSON.stringify(payload) }),
          fetch(`${baseUrl}/.netlify/functions/notify-store`, { method: 'POST', body: JSON.stringify(payload) })
        ]);
      }
    }

    // Sempre retorne 200 para o Mercado Pago não ficar reenviando o aviso
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
    
  } catch (error) {
    console.error('Erro no Webhook:', error.message);
    return { statusCode: 200, body: JSON.stringify({ error: error.message }) };
  }
};
