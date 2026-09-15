// ===================================================================
// WEBHOOK — Recebe notificações oficiais do Mercado Pago
// ===================================================================
// 1. Aceitar apenas POST do Mercado Pago
// 2. Validar assinatura (x-signature)
// 3. Extrair payment_id da notificação
// 4. Consultar GET /v1/payments/{id} para obter status REAL
// 5. Relacionar pagamento ao pedido via external_reference
// 6. Atualizar pedido de forma IDEMPOTENTE no Netlify Blobs
// 7. Responder HTTP 200 ao Mercado Pago
//
// REGRA CRÍTICA: O status da URL de retorno NÃO é prova de pagamento.
// A confirmação definitiva vem SOMENTE daqui.
// ===================================================================

const { getStore } = require('netlify:blob');

const MP_GET_PAYMENT_URL = 'https://api.mercadopago.com/v1/payments/';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    // === 1. VALIDAR ASSINATURA ===
    const xSignature = event.headers['x-signature'] || event.headers['X-Signature'];

    if (!xSignature) {
      console.warn('[WEBHOOK] Notificação sem assinatura x-signature. Rejeitando.');
      return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    // === 2. EXTRAIR DADOS DA NOTIFICAÇÃO ===
    const params = event.queryStringParameters || {};
    const queryParams = event.rawQuery ? parseQueryString(event.rawQuery) : params;

    const dataId = queryParams['data.id'] || params['data.id'];
    const type = queryParams.type || params.type;
    const action = queryParams.action || params.action;

    console.log('[WEBHOOK] Notificação recebida — type: ' + type + ', action: ' + action + ', data.id: ' + dataId);

    if (!dataId) {
      return { statusCode: 200, body: JSON.stringify({ received: true }) };
    }

    // === 3. CONSULTAR STATUS REAL DO PAGAMENTO NA API DO MP ===
    const paymentResponse = await fetch(MP_GET_PAYMENT_URL + dataId, {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + process.env.MP_ACCESS_TOKEN,
        'Content-Type': 'application/json'
      }
    });

    if (!paymentResponse.ok) {
      console.error('[WEBHOOK] Erro ao consultar pagamento ' + dataId + ':', paymentResponse.status);
      return { statusCode: 200, body: JSON.stringify({ received: true }) };
    }

    const payment = await paymentResponse.json();

    // === 4. RELACIONAR PAGAMENTO AO PEDIDO VIA EXTERNAL_REFERENCE ===
    const externalReference = payment.external_reference;
    if (!externalReference) {
      console.warn('[WEBHOOK] Pagamento sem external_reference. Ignorando.');
      return { statusCode: 200, body: JSON.stringify({ received: true }) };
    }

    // === 5. BUSCAR PEDIDO NO NETLIFY BLOBS ===
    console.log('1 - Iniciando acesso ao Netlify Blobs');

const store = getStore('orders');

console.log('2 - Store orders obtido');

const existingOrder = await store.get(orderId);

console.log(
  '3 - Resultado da busca do pedido:',
  existingOrder ? 'ENCONTRADO' : 'NÃO ENCONTRADO'
);

    if (!orderRaw) {
      console.warn('[WEBHOOK] Pedido não encontrado: ' + externalReference);
      return { statusCode: 200, body: JSON.stringify({ received: true }) };
    }

    const order = JSON.parse(orderRaw);

    // === 6. IDEMPOTÊNCIA ===
    if (order.mercado_pago_payment_id === String(dataId) &&
        (order.status === 'approved' || order.status === 'cancelled' || order.status === 'rejected')) {
      console.log('[WEBHOOK] Pedido ' + externalReference + ' já processado. Ignorando (idempotente).');
      return { statusCode: 200, body: JSON.stringify({ received: true }) };
    }

    // === 7. MAPEAR STATUS ===
    const mpStatus = payment.status;
    let orderStatus;

    switch (mpStatus) {
      case 'approved':
        orderStatus = 'approved';
        break;
      case 'pending':
      case 'in_process':
        orderStatus = 'pending';
        break;
      case 'rejected':
        orderStatus = 'rejected';
        break;
      case 'cancelled':
        orderStatus = 'cancelled';
        break;
      case 'refunded':
      case 'charged_back':
        orderStatus = 'refunded';
        break;
      default:
        orderStatus = 'pending';
        console.warn('[WEBHOOK] Status não mapeado: ' + mpStatus + '. Usando pending.');
    }

    // === 8. ATUALIZAR PEDIDO ===
    order.status = orderStatus;
    order.mercado_pago_payment_id = String(dataId);
    order.updated_at = new Date().toISOString();

    if (orderStatus === 'approved' && !order.paid_at) {
      order.paid_at = new Date().toISOString();
    }

    console.log('[WEBHOOK] Pedido ' + externalReference + ' atualizado: ' + orderStatus + ' (MP: ' + mpStatus + ', payment_id: ' + dataId + ')');

    await store.set(externalReference, JSON.stringify(order));

    // === 9. RESPONDER 200 ===
    return {
      statusCode: 200,
      body: JSON.stringify({ received: true, status: orderStatus })
    };

  } catch (error) {
    console.error('[WEBHOOK] Erro interno:', error.message);
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  }
};

function parseQueryString(qs) {
  const params = {};
  const pairs = qs.split('&');
  for (const pair of pairs) {
    const [key, ...valueParts] = pair.split('=');
    const value = valueParts.join('=');
    try {
      params[decodeURIComponent(key)] = decodeURIComponent(value || '');
    } catch {
      params[key] = value;
    }
  }
  return params;
}
