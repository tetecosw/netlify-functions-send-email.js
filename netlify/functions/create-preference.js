const { MercadoPagoConfig, Preference } = require('mercadopago');
const { connectLambda, getStore } = require('@netlify/blobs');

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN
});

const preferenceClient = new Preference(client);

exports.handler = async (event, context) => {
  // Inicializa o contexto do Netlify Blobs
  connectLambda(event);

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Preflight CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  // Somente POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({
        error: 'Método não permitido'
      })
    };
  }

  try {
    const data = JSON.parse(event.body || '{}');

    // Validação básica
    if (
      !data.items ||
      !Array.isArray(data.items) ||
      data.items.length === 0 ||
      !data.origin
    ) {
      throw new Error('Dados insuficientes para criar a preferência.');
    }

    // ID do pedido
    const orderId =
      data.external_reference || `SKP_${Date.now()}`;

    // Preferência do Mercado Pago
    const preference = {
      items: data.items,
      payer: data.payer || {},
      external_reference: orderId,

     back_urls: {
  success: `${data.origin}/?status=success&orderId=${encodeURIComponent(orderId)}`,
  failure: `${data.origin}/?status=failure&orderId=${encodeURIComponent(orderId)}`,
  pending: `${data.origin}/?status=pending&orderId=${encodeURIComponent(orderId)}`
},

auto_return: 'approved',

      binary_mode: true,
      statement_descriptor: 'SKINCAREPRO'
    };

    // Cria a preferência no Mercado Pago
    const response = await preferenceClient.create({
      body: preference
    });

    // Inicializa o Netlify Blobs
    const store = getStore('orders');

    // Calcula o valor total
    const total = data.items.reduce(
      (sum, item) =>
        sum +
        Number(item.unit_price || 0) *
          Number(item.quantity || 0),
      0
    );

    // Salva os dados originais do pedido
    await store.set(
      orderId,
      JSON.stringify({
        order_id: orderId,
        status: 'created',
        amount: total,
        currency: 'BRL',
        items: data.items,

        cliente: {
          nome: data.payer?.name || '',
          email: data.payer?.email || '',
          telefone: data.payer?.phone?.number || ''
        },

        preference_id: response.id,
        created_at: new Date().toISOString()
      })
    );

    console.log(
      `Pedido criado: ${orderId} | Preference: ${response.id}`
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        preferenceId: response.id,
        init_point: response.init_point
      })
    };

  } catch (error) {
    console.error(
      'Erro na Function:',
      error.message
    );

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Erro ao processar pagamento',
        details: error.message
      })
    };
  }
};