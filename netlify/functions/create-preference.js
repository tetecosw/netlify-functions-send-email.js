// ===================================================================
// CREATE PREFERENCE — Cria pedido + preferência de pagamento no MP
// ===================================================================
// 1. Receber product_id + quantity do frontend (NUNCA preço)
// 2. Validar dados de entrada
// 3. Buscar preço real no catálogo do backend (products.js)
// 4. Criar pedido no Netlify Blobs com status "pending"
// 5. Criar preferência no Mercado Pago via API
// 6. Associar external_reference ao orderId
// 7. Configurar back_urls e notification_url
// 8. Retornar apenas preferenceId + orderId ao frontend
// ===================================================================


const { PRODUCTS } = require('./products');

const MP_PREFERENCE_URL = 'https://api.mercadopago.com/checkout/preferences';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Método não permitido. Use POST.' })
    };
  }

  try {
    // === 1. PARSE E VALIDAÇÃO DE ENTRADA ===
    const body = JSON.parse(event.body || '{}');
    const { items: clientItems, payer } = body;

    if (!clientItems || !Array.isArray(clientItems) || clientItems.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Carrinho vazio. Envie ao menos um produto.' })
      };
    }

    if (!payer || !payer.name || !payer.email) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Nome e e-mail do comprador são obrigatórios.' })
      };
    }

    // === 2. BUSCAR PREÇO REAL NO BACKEND ===
    const validatedItems = [];
    let totalAmount = 0;

    for (const clientItem of clientItems) {
      const productId = clientItem.id;
      const quantity = parseInt(clientItem.quantity, 10);

      if (!quantity || quantity < 1 || quantity > 99) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Quantidade inválida para o produto: ' + productId })
        };
      }

      const product = PRODUCTS[productId];
      if (!product) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Produto não encontrado: ' + productId })
        };
      }

      validatedItems.push({
        id: product.id,
        title: product.name,
        description: product.description,
        quantity: quantity,
        unit_price: product.price,
        currency_id: product.currency
      });

      totalAmount += product.price * quantity;
    }

    // === 3. CRIAR IDENTIFICADOR ÚNICO DO PEDIDO ===
    const orderId = 'SKP-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    const externalReference = orderId;

    // === 4. PERSISTIR PEDIDO NO NETLIFY BLOBS ===
    const store = getStore('orders');
    const orderData = {
      order_id: orderId,
      items: validatedItems,
      payer: {
        name: payer.name,
        email: payer.email,
        phone: payer.phone || null
      },
      amount: totalAmount,
      currency: 'BRL',
      status: 'pending',
      mercado_pago_preference_id: null,
      mercado_pago_payment_id: null,
      external_reference: externalReference,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      paid_at: null
    };

    await store.set(orderId, JSON.stringify(orderData));

    // === 5. CRIAR PREFERÊNCIA NO MERCADO PAGO ===
    const origin = event.headers.origin || 'https://skincareprostore.netlify.app';

    const preferenceBody = {
      items: validatedItems,
      payer: {
        name: payer.name,
        email: payer.email,
        ...(payer.phone && { phone: { number: payer.phone } })
      },
      external_reference: externalReference,
      statement_descriptor: 'SKINCAREPROSTORE',
      back_urls: {
        success: origin + '/?status=success&order=' + orderId,
        pending: origin + '/?status=pending&order=' + orderId,
        failure: origin + '/?status=failure&order=' + orderId
      },
      auto_return: 'approved',
      binary_mode: true,
      notification_url: origin + '/.netlify/functions/webhook',
      metadata: {
        order_id: orderId
      }
    };

    const mpResponse = await fetch(MP_PREFERENCE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + process.env.MP_ACCESS_TOKEN
      },
      body: JSON.stringify(preferenceBody)
    });

    if (!mpResponse.ok) {
      const errorData = await mpResponse.text();
      console.error('[CREATE-PREFERENCE] Erro MP API:', mpResponse.status, errorData);

      orderData.status = 'error';
      orderData.updated_at = new Date().toISOString();
      orderData.error = 'Falha ao criar preferência no Mercado Pago';
      await store.set(orderId, JSON.stringify(orderData));

      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Falha ao criar preferência de pagamento.' })
      };
    }

    const preference = await mpResponse.json();

    // === 6. ATUALIZAR PEDIDO COM PREFERENCE ID ===
    orderData.mercado_pago_preference_id = preference.id;
    orderData.updated_at = new Date().toISOString();
    await store.set(orderId, JSON.stringify(orderData));

    // === 7. RETORNAR APENAS O NECESSÁRIO AO FRONTEND ===
    return {
      statusCode: 200,
      body: JSON.stringify({
        preferenceId: preference.id,
        orderId: orderId,
        initPoint: preference.init_point
      })
    };

  } catch (error) {
    console.error('[CREATE-PREFERENCE] Erro interno:', error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Erro interno do servidor. Tente novamente.' })
    };
  }
};
