const mercadopago = require('mercadopago');

// Configura o Mercado Pago com seu Token Secreto
// No Netlify, você configurará a variável MP_ACCESS_TOKEN no painel
mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN 
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body);

    const preference = {
      items: body.items,
      payer: body.payer,
      external_reference: body.external_reference,
      back_urls: body.back_urls,
      auto_return: 'approved',
    };

    const response = await mercadopago.preferences.create(preference);

    return {
      statusCode: 200,
      body: JSON.stringify({ preferenceId: response.body.id }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
