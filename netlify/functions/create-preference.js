const { MercadoPagoConfig, Preference } = require('mercadopago');
const { connectLambda, getStore } = require('@netlify/blobs');

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN
});

const preferenceClient = new Preference(client);

exports.handler = async (event) => {
  // Inicializa o contexto do Netlify Blobs
  connectLambda(event);

  const siteUrl = process.env.SITE_URL;

  const headers = {
    'Access-Control-Allow-Origin': siteUrl || '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Verifica configuração obrigatória
  if (!process.env.MP_ACCESS_TOKEN) {
    console.error('MP_ACCESS_TOKEN não configurado.');
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Mercado Pago não configurado no servidor.'
      })
    };
  }

  if (!siteUrl) {
    console.error('SITE_URL não configurada.');

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'SITE_URL não configurada no servidor.'
      })
    };
  }

  // Preflight CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
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
      data.items.length === 0
    ) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Nenhum item foi enviado para o pagamento.'
        })
      };
    }

    // ID do pedido
    const orderId =
      data.external_reference ||
      `SKP_${Date.now()}`;

    // Preferência do Mercado Pago
    const preference = {
      items: data.items,

      payer: {
        name: data.payer?.name || '',
        email: data.payer?.email || '',
        phone: {
          number: data.payer?.phone?.number || ''
        }
      },

      external_reference: orderId,

      back_urls: {
        success: `${siteUrl}/?status=success&orderId=${encodeURIComponent(orderId)}`,
        failure: `${siteUrl}/?status=failure&orderId=${encodeURIComponent(orderId)}`,
        pending: `${siteUrl}/?status=pending&orderId=${encodeURIComponent(orderId)}`
      },

      auto_return: 'approved',

      statement_descriptor: 'SKINCAREPRO'
    };

    // Cria a preferência no Mercado Pago
    const response = await preferenceClient.create({
      body: preference
    });

    if (!response || !response.id) {
      throw new Error(
        'Mercado Pago não retornou um ID de preferência.'
      );
    }

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

    // Salva os dados do pedido
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
    console.error('Erro na Function:', error);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Erro ao processar pagamento',
        details:
          process.env.NODE_ENV === 'development'
            ? error.message
            : undefined
      })
    };
  }
};