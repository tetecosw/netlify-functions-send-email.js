// ===================================================================
// GET ORDER — Consulta o status REAL do pedido no backend
// O frontend usa este endpoint para mostrar o status correto.
// NUNCA confia em parâmetros de URL (?status=success).
// ===================================================================

const { connectLambda, getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  // Inicializa o contexto do Netlify Blobs
  connectLambda(event);

  // Aceita somente GET
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        error: 'Method not allowed'
      })
    };
  }

  try {
    const params = event.queryStringParameters || {};
    const orderId = params.orderId;

    if (!orderId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          error: 'orderId é obrigatório.'
        })
      };
    }

    const store = getStore('orders');

    const orderRaw = await store.get(orderId);

    if (!orderRaw) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          error: 'Pedido não encontrado.'
        })
      };
    }

    const order = JSON.parse(orderRaw);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        order_id: order.order_id,
        status: order.status,
        amount: order.amount,
        currency: order.currency,
        items: order.items,
        cliente: order.cliente || null,
        created_at: order.created_at,
        paid_at: order.paid_at || null
      })
    };

  } catch (error) {
    console.error(
      '[GET-ORDER] Erro:',
      error.message
    );

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        error: 'Erro interno.'
      })
    };
  }
};