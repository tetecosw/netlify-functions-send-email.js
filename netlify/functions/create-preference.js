const mercadopago = require('mercadopago');

// Configuração do Mercado Pago
mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN 
});

exports.handler = async (event, context) => {
  // Cabeçalhos para evitar erros de CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Responde rapidamente a requisições de verificação (OPTIONS)
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método não permitido' }) };
  }

  try {
    const data = JSON.parse(event.body);

    // Validação básica dos dados recebidos
    if (!data.items || !data.origin) {
      throw new Error('Dados insuficientes para criar a preferência.');
    }

    const preference = {
      items: data.items,
      payer: data.payer,
      external_reference: data.external_reference || 'SKP_ORDER',
      back_urls: {
        success: `${data.origin}/?status=success`,
        failure: `${data.origin}/?status=failure`,
        pending: `${data.origin}/?status=pending`
      },
      auto_return: 'approved',
      binary_mode: true,
      statement_descriptor: 'SKINCAREPRO'
    };

    const response = await mercadopago.preferences.create(preference);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        preferenceId: response.body.id,
        init_point: response.body.init_point 
      }),
    };
  } catch (error) {
    console.error('Erro na Function:', error.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Erro ao processar pagamento', details: error.message }),
    };
  }
};
