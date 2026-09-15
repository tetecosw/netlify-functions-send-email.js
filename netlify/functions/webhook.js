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

const {
  MercadoPagoConfig,
  Payment,
  WebhookSignatureValidator
} = require('mercadopago');

const { connectLambda, getStore } = require('@netlify/blobs');

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN
});

const paymentClient = new Payment(client);

exports.handler = async (event) => {
  connectLambda(event);

  const headers = {
    'Content-Type': 'application/json'
  };

  // Apenas POST
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
    const secret = process.env.MP_WEBHOOK_SECRET;

    if (!secret) {
      console.error('MP_WEBHOOK_SECRET não configurado.');

      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: 'Webhook secret não configurado.'
        })
      };
    }

    const xSignature = event.headers?.['x-signature'];
    const xRequestId = event.headers?.['x-request-id'];

    const queryParams = event.queryStringParameters || {};

    const dataId = queryParams['data.id'];

    if (!xSignature || !xRequestId || !dataId) {
      console.error('Dados de assinatura incompletos.');

      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Dados do webhook incompletos.'
        })
      };
    }

    // Valida se a notificação realmente veio do Mercado Pago
    try {
      WebhookSignatureValidator.validate({
        xSignature,
        xRequestId,
        dataId,
        secret
      });
    } catch (signatureError) {
      console.error(
        'Assinatura do webhook inválida:',
        signatureError.message
      );

      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({
          error: 'Assinatura inválida.'
        })
      };
    }

    // Lê o corpo enviado pelo Mercado Pago
    const body = JSON.parse(event.body || '{}');

    console.log('Webhook recebido:', JSON.stringify(body));

    // Queremos somente notificações de pagamento
    if (body.type !== 'payment') {
      console.log(
        `Webhook ignorado. Tipo recebido: ${body.type}`
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          received: true,
          ignored: true
        })
      };
    }

    const paymentId = body.data?.id || dataId;

    if (!paymentId) {
      console.error('ID do pagamento não encontrado.');

      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'ID do pagamento não encontrado.'
        })
      };
    }

    // Consulta o pagamento diretamente na API do Mercado Pago
    const payment = await paymentClient.get({
      id: paymentId
    });

    console.log(
      `Pagamento consultado: ${payment.id} | Status: ${payment.status}`
    );

    const orderId = payment.external_reference;

    if (!orderId) {
      console.warn(
        `Pagamento ${payment.id} não possui external_reference.`
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          received: true,
          warning: 'Pagamento sem external_reference.'
        })
      };
    }

    // Abre o banco de pedidos do Netlify
    const store = getStore('orders');

    const existingOrder = await store.get(orderId);

    if (!existingOrder) {
      console.warn(
        `Pedido ${orderId} não encontrado no Netlify Blobs.`
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          received: true,
          warning: 'Pedido não encontrado.'
        })
      };
    }

    const order =
      typeof existingOrder === 'string'
        ? JSON.parse(existingOrder)
        : existingOrder;

    // Atualiza o pedido com os dados reais do Mercado Pago
    order.status = payment.status;
    order.payment_id = String(payment.id);
    order.payment_status = payment.status;
    order.payment_status_detail = payment.status_detail || null;
    order.payment_method_id = payment.payment_method_id || null;
    order.updated_at = new Date().toISOString();

    if (payment.status === 'approved') {
      order.paid_at = new Date().toISOString();
    }

    await store.set(
      orderId,
      JSON.stringify(order)
    );

    console.log(
      `Pedido atualizado: ${orderId} → ${payment.status}`
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        received: true,
        orderId,
        paymentId: String(payment.id),
        status: payment.status
      })
    };

  } catch (error) {
    console.error(
      'Erro no Webhook Mercado Pago:',
      error
    );

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Erro ao processar webhook.'
      })
    };
  }
};
