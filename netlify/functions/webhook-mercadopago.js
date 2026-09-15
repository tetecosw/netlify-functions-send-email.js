// ============================================================
// WEBHOOK - SKINCARE PRO STORE
// Recebe notificações de pagamento do Mercado Pago
// ============================================================

```js
const { getStore, connectLambda } = require('@netlify/blobs');
const { WebhookSignatureValidator } = require('mercadopago');

const MP_API_URL = 'https://api.mercadopago.com/v1/payments/';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers':
      'Content-Type, x-signature, x-request-id',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // ==============================
  // CORS / OPTIONS
  // ==============================

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers,
      body: ''
    };
  }

  // ==============================
  // SOMENTE POST
  // ==============================

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({
        error: 'Method not allowed'
      })
    };
  }

  try {
    // ==============================
    // CONECTA NETLIFY BLOBS
    // ==============================

    connectLambda(event);

    // ==============================
    // VERIFICA CREDENCIAIS
    // ==============================

    if (!process.env.MP_ACCESS_TOKEN) {
      console.error(
        '[WEBHOOK] MP_ACCESS_TOKEN não configurado.'
      );

      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: 'Mercado Pago não configurado.'
        })
      };
    }

    if (!process.env.MP_WEBHOOK_SECRET) {
      console.error(
        '[WEBHOOK] MP_WEBHOOK_SECRET não configurado.'
      );

      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: 'Webhook secret não configurado.'
        })
      };
    }

    // ==============================
    // DADOS DA ASSINATURA
    // ==============================

    const queryParams =
      event.queryStringParameters || {};

    const dataId =
      queryParams['data.id'] ||
      queryParams['data_id'] ||
      null;

    const xSignature =
      event.headers['x-signature'] ||
      event.headers['X-Signature'] ||
      '';

    const xRequestId =
      event.headers['x-request-id'] ||
      event.headers['X-Request-Id'] ||
      '';

    console.log(
      '[WEBHOOK] Notificação recebida:',
      {
        dataId,
        hasSignature: Boolean(xSignature),
        hasRequestId: Boolean(xRequestId)
      }
    );

    // ==============================
    // VALIDA DADOS DA ASSINATURA
    // ==============================

    if (
      !xSignature ||
      !xRequestId ||
      !dataId
    ) {
      console.warn(
        '[WEBHOOK] Dados necessários para validação não encontrados.'
      );

      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({
          error: 'Webhook não autorizado.'
        })
      };
    }

    // ==============================
    // VALIDA ASSINATURA MERCADO PAGO
    // ==============================

    try {
      WebhookSignatureValidator.validate({
        xSignature,
        xRequestId,
        dataId,
        secret: process.env.MP_WEBHOOK_SECRET
      });

      console.log(
        '[WEBHOOK] Assinatura validada com sucesso.'
      );
    } catch (signatureError) {
      console.warn(
        '[WEBHOOK] Assinatura inválida:',
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

    // ==============================
    // LÊ BODY
    // ==============================

    const body = JSON.parse(
      event.body || '{}'
    );

    console.log(
      '[WEBHOOK] Tipo:',
      body.type,
      '| Ação:',
      body.action,
      '| Payment ID:',
      dataId
    );

    // ==============================
    // SOMENTE EVENTOS DE PAGAMENTO
    // ==============================

    if (body.type !== 'payment') {
      console.log(
        '[WEBHOOK] Notificação ignorada. Tipo:',
        body.type
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          received: true
        })
      };
    }

    // ==============================
    // CONSULTA PAGAMENTO NO MERCADO PAGO
    // ==============================

    const paymentResponse = await fetch(
      MP_API_URL + encodeURIComponent(dataId),
      {
        method: 'GET',
        headers: {
          Authorization:
            `Bearer ${process.env.MP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const payment = await paymentResponse.json();

    if (!paymentResponse.ok) {
      console.error(
        '[WEBHOOK] Erro ao consultar pagamento:',
        payment
      );

      // Retorna 200 para evitar
      // reprocessamento desnecessário
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          received: true
        })
      };
    }

    // ==============================
    // DADOS DO PAGAMENTO
    // ==============================

    const paymentId =
      String(payment.id);

    const status =
      payment.status;

    const externalReference =
      payment.external_reference;

    const amount =
      Number(
        payment.transaction_amount || 0
      );

    const paymentMethod =
      payment.payment_method_id || '';

    const statusDetail =
      payment.status_detail || '';

    console.log(
      `[WEBHOOK] Pagamento ${paymentId} | ` +
      `Status: ${status} | ` +
      `Pedido: ${externalReference} | ` +
      `Valor: ${amount}`
    );

    // ==============================
    // VERIFICA PEDIDO
    // ==============================

    if (!externalReference) {
      console.warn(
        '[WEBHOOK] Pagamento sem external_reference.'
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          received: true
        })
      };
    }

    // ==============================
    // ACESSA NETLIFY BLOBS
    // ==============================

    const store =
      getStore('orders');

    const orderRaw =
      await store.get(
        externalReference
      );

    if (!orderRaw) {
      console.warn(
        `[WEBHOOK] Pedido não encontrado: ${externalReference}`
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          received: true
        })
      };
    }

    // ==============================
    // CONVERTE PEDIDO
    // ==============================

    let order;

    try {
      order =
        JSON.parse(orderRaw);
    } catch (error) {
      console.error(
        '[WEBHOOK] Erro ao interpretar pedido:',
        error
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          received: true
        })
      };
    }

    // ==============================
    // IDEMPOTÊNCIA
    // EVITA PROCESSAR DUAS VEZES
    // ==============================

    if (
      order.mercado_pago_payment_id ===
        paymentId &&
      order.payment_status ===
        status
    ) {
      console.log(
        `[WEBHOOK] Pedido ${externalReference} ` +
        `já está atualizado.`
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          received: true,
          status
        })
      };
    }

    // ==============================
    // CONVERTE STATUS DO MERCADO PAGO
    // PARA STATUS INTERNO DO PEDIDO
    // ==============================

    let orderStatus;

    switch (status) {
      case 'approved':
        orderStatus = 'approved';
        break;

      case 'pending':
        orderStatus = 'pending';
        break;

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
        orderStatus = 'refunded';
        break;

      case 'charged_back':
        orderStatus = 'refunded';
        break;

      default:
        orderStatus = 'pending';
        break;
    }

    // ==============================
    // ATUALIZA PEDIDO
    // ==============================

    order.status =
      orderStatus;

    order.payment_status =
      status;

    order.payment_status_detail =
      statusDetail;

    order.mercado_pago_payment_id =
      paymentId;

    order.payment_method_id =
      paymentMethod;

    order.payment_amount =
      amount;

    order.updated_at =
      new Date().toISOString();

    // ==============================
    // REGISTRA DATA DO PAGAMENTO
    // ==============================

    if (
      orderStatus === 'approved' &&
      !order.paid_at
    ) {
      order.paid_at =
        new Date().toISOString();
    }

    // ==============================
    // SALVA PEDIDO ATUALIZADO
    // ==============================

    await store.set(
      externalReference,
      JSON.stringify(order)
    );

    console.log(
      `[WEBHOOK] Pedido ${externalReference} ` +
      `atualizado com sucesso: ${orderStatus}`
    );

    // ==============================
    // RESPOSTA FINAL
    // ==============================

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        received: true,
        orderId: externalReference,
        status: orderStatus
      })
    };

  } catch (error) {

    console.error(
      '[WEBHOOK] Erro interno:',
      error
    );

    // O Mercado Pago recebeu a notificação,
    // portanto retornamos 200.
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        received: true
      })
    };
  }
};
```
