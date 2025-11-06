
EO# Create server.js
cat > server.js << 'EOF'
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const userBalances = new Map();
const pendingCharges = new Map();

const COINBASE_API_KEY = process.env.COINBASE_COMMERCE_API_KEY;
const COINBASE_WEBHOOK_SECRET = process.env.COINBASE_WEBHOOK_SECRET;
const TOKEN_CONTRACT = process.env.TOKEN_CONTRACT || '0xf5fa0104d9e23f4ba4c59a73d88241cbe26ed754';

app.post('/api/create-charge', async (req, res) => {
  try {
    const { amount, userId } = req.body;
    
    if (!amount || amount < 100 || amount > 10000) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const priceUSD = (amount * 0.01).toFixed(2);

    const charge = await fetch('https://api.commerce.coinbase.com/charges', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CC-Api-Key': COINBASE_API_KEY,
        'X-CC-Version': '2018-03-22'
      },
      body: JSON.stringify({
        name: 'ZORA Tokens',
        description: `Purchase ${amount} ZORA tokens for Blackjack game`,
        pricing_type: 'fixed_price',
        local_price: {
          amount: priceUSD,
          currency: 'USD'
        },
        metadata: {
          user_id: userId,
          token_amount: amount,
          token_contract: TOKEN_CONTRACT
        },
        redirect_url: process.env.FRONTEND_URL || 'http://localhost:3000',
        cancel_url: process.env.FRONTEND_URL || 'http://localhost:3000'
      })
    });

    const chargeData = await charge.json();

    if (chargeData.data) {
      pendingCharges.set(chargeData.data.id, {
        userId,
        amount,
        status: 'pending'
      });

      res.json({
        success: true,
        chargeId: chargeData.data.id,
        hostedUrl: chargeData.data.hosted_url,
        amount,
        priceUSD
      });
    } else {
      throw new Error('Failed to create charge');
    }
  } catch (error) {
    console.error('Error creating charge:', error);
    res.status(500).json({ 
      error: 'Failed to create charge',
      message: error.message 
    });
  }
});

app.post('/api/webhook/coinbase', (req, res) => {
  try {
    const signature = req.headers['x-cc-webhook-signature'];
    const body = JSON.stringify(req.body);
    
    const expectedSignature = crypto
      .createHmac('sha256', COINBASE_WEBHOOK_SECRET)
      .update(body)
      .digest('hex');

    if (signature !== expectedSignature) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const event = req.body;
    
    if (event.event.type === 'charge:confirmed') {
      const chargeId = event.event.data.id;
      const charge = pendingCharges.get(chargeId);

      if (charge) {
        const currentBalance = userBalances.get(charge.userId) || 1000;
        userBalances.set(charge.userId, currentBalance + charge.amount);
        
        charge.status = 'completed';
        pendingCharges.set(chargeId, charge);

        console.log(`Payment confirmed for user ${charge.userId}: +${charge.amount} tokens`);
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

app.get('/api/balance/:userId', (req, res) => {
  const { userId } = req.params;
  const balance = userBalances.get(userId) || 1000;
  res.json({ balance });
});

app.post('/api/balance/update', (req, res) => {
  const { userId, newBalance } = req.body;
  
  if (newBalance < 0) {
    return res.status(400).json({ error: 'Invalid balance' });
  }

  userBalances.set(userId, newBalance);
  res.json({ success: true, balance: newBalance });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    contract: TOKEN_CONTRACT 
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📝 Webhook URL: /api/webhook/coinbase`);
  console.log(`🎮 Token: ${TOKEN_CONTRACT}`);
});
EOF
