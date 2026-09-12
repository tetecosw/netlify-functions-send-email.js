const { connectLambda, getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
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

  // Mercado Pago envia notificações via POST
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
    const body = JSON.parse(event.body || '{}');

    // Processa somente notificações de pagamento
    if (body.type === 'payment' || body.topic === 'payment') {
      const paymentId =
        body.data?.id ||
        body.resource?.split('/').pop();

      // Se não houver ID, apenas confirma o recebimento
      if (!paymentId) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            received: true,
            message: 'Payment ID not found'
          })
        };
      }

      // Consulta o pagamento diretamente na API do Mercado Pago
      const payResponse = await fetch(
        `https://api.mercadopago.com/v1/payments/${paymentId}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`
          }
        }
      );

      if (!payResponse.ok) {
        const errorText = await payResponse.text();

        console.error(
          'Falha ao consultar pagamento no Mercado Pago:',
          payResponse.status,
          errorText
        );

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            received: true,
            validated: false
          })
        };
      }

      const payment = await payResponse.json();

      const status = payment.status;
      const externalRef = payment.external_reference;
      const amount = payment.transaction_amount;
      const payer = payment.payer || {};
      const paymentMethod = payment.payment_method_id;

      console.log(
        `Pedido: ${externalRef} | Status: ${status}`
      );

      // ==========================================================
      // PAGAMENTO APROVADO
      // ==========================================================
      if (status === 'approved') {
        const store = getStore('orders');

        // Recupera o pedido criado pela loja antes do pagamento
        const existingRaw = await store.get(externalRef);
        const existingOrder = existingRaw
          ? JSON.parse(existingRaw)
          : {};

        // Evita processar duas vezes o mesmo pedido
        if (existingOrder.status === 'approved') {
          console.log(
            `Pedido ${externalRef} já foi processado anteriormente.`
          );

          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              received: true,
              alreadyProcessed: true
            })
          };
        }

        // Recupera os dados do cliente salvos na criação do pedido
        const cliente = existingOrder.cliente || {
          nome:
            payer.first_name ||
            payer.name ||
            'Cliente',

          email:
            payer.email ||
            '',

          telefone:
            payer.phone?.number ||
            ''
        };

        // Atualiza o pedido para aprovado
        await store.set(
          externalRef,
          JSON.stringify({
            ...existingOrder,

            order_id: externalRef,

            status: 'approved',

            amount: amount,

            currency: 'BRL',

            items:
              payment.additional_info?.items ||
              existingOrder.items ||
              [],

            cliente: cliente,

            created_at:
              existingOrder.created_at ||
              payment.date_created,

            paid_at:
              payment.date_approved,

            payment_id: paymentId,

            payment_method: paymentMethod
          })
        );

        console.log(
          `Pedido ${externalRef} salvo no Netlify Blobs.`
        );

        // Dados usados pelas funções de notificação
        const payload = {
          pedidoId: externalRef,

          cliente: {
            nome:
              cliente.nome ||
              'Cliente',

            email:
              cliente.email ||
              '',

            telefone:
              cliente.telefone ||
              ''
          },

          total: amount,

          metodo: paymentMethod,

          pagamento: {
            id: paymentId,
            status: status
          }
        };

        const baseUrl =
          process.env.URL ||
          '';

        // Executa as três notificações
        const results = await Promise.allSettled([
          fetch(
            `${baseUrl}/.netlify/functions/send-email`,
            {
              method: 'POST',

              headers: {
                'Content-Type': 'application/json'
              },

              body: JSON.stringify(payload)
            }
          ),

          fetch(
            `${baseUrl}/.netlify/functions/send-whatsapp`,
            {
              method: 'POST',

              headers: {
                'Content-Type': 'application/json'
              },

              body: JSON.stringify(payload)
            }
          ),

          fetch(
            `${baseUrl}/.netlify/functions/notify-store`,
            {
              method: 'POST',

              headers: {
                'Content-Type': 'application/json'
              },

              body: JSON.stringify(payload)
            }
          )
        ]);

        // Registra o resultado de cada notificação
        results.forEach((result, index) => {
          const names = [
            'send-email',
            'send-whatsapp',
            'notify-store'
          ];

          if (result.status === 'fulfilled') {
            console.log(
              `${names[index]} executada. HTTP ${result.value.status}`
            );
          } else {
            console.error(
              `${names[index]} falhou:`,
              result.reason?.message || result.reason
            );
          }
        });
      }

      // ==========================================================
      // PAGAMENTO PENDENTE
      // ==========================================================
      if (status === 'pending') {
        console.log(
          `Pagamento pendente - Pedido: ${externalRef} - Método: ${paymentMethod}`
        );
      }

      // ==========================================================
      // PAGAMENTO RECUSADO
      // ==========================================================
      if (status === 'rejected') {
        console.log(
          `Pagamento recusado - Pedido: ${externalRef} - Motivo: ${payment.status_detail}`
        );
      }
    }

    // Mercado Pago deve receber 200
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        received: true
      })
    };

  } catch (error) {
    console.error(
      'Erro no Webhook:',
      error.message
    );

    // Mantém 200 para evitar reenvios desnecessários
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        received: true,
        error: error.message
      })
    };
  }
};