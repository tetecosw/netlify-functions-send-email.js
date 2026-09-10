const mercadopago = require('mercadopago');
const nodemailer = require('nodemailer');

// Configuração do Mercado Pago usando sua variável de ambiente do Netlify
mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN 
});

exports.handler = async (event, context) => {
  // Segurança: Permitir apenas requisições POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Método não permitido' }),
    };
  }

  try {
    const data = JSON.parse(event.body);

    // Estrutura da Preferência de Compra
    const preference = {
      items: data.items, // Array com nome, preço e quantidade
      payer: data.payer, // Dados do comprador (email, nome)
      external_reference: data.external_reference || 'venda_lp_001',
      back_urls: {
        success: `${data.origin}/sucesso`,
        failure: `${data.origin}/erro`,
        pending: `${data.origin}/pendente`
      },
      auto_return: 'approved',
      binary_mode: true // Evita pagamentos pendentes que exigem ação manual
    };

    // Criação da preferência no Mercado Pago
    const response = await mercadopago.preferences.create(preference);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        preferenceId: response.body.id,
        init_point: response.body.init_point // Link para o Checkout Pro
      }),
    };
  } catch (error) {
    console.error('Erro ao criar preferência:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Erro interno ao processar o pagamento',
        details: error.message 
      }),
    };
  }
};
