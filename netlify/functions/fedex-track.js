const https = require('https');

async function getToken() {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.FEDEX_CLIENT_ID,
      client_secret: process.env.FEDEX_CLIENT_SECRET
    }).toString();

    const req = https.request({
      hostname: 'apis.fedex.com',
      path: '/oauth/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function trackPackage(token, trackingNumber) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      includeDetailedScans: true,
      trackingInfo: [{ trackingNumberInfo: { trackingNumber } }]
    });

    const req = https.request({
      hostname: 'apis.fedex.com',
      path: '/track/v1/trackingnumbers',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'X-locale': 'en_US',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { trackingNumber } = JSON.parse(event.body);
    if (!trackingNumber) return { statusCode: 400, body: JSON.stringify({ error: 'No tracking number' }) };

    const tokenData = await getToken();
    if (!tokenData.access_token) return { statusCode: 401, body: JSON.stringify({ error: 'Auth failed' }) };

    const result = await trackPackage(tokenData.access_token, trackingNumber);

    const trackResult = result?.output?.completeTrackResults?.[0]?.trackResults?.[0];
    if (!trackResult) return { statusCode: 200, body: JSON.stringify({ error: 'No data' }) };

    const statusCode = trackResult.latestStatusDetail?.code || '';
    const statusDesc = trackResult.latestStatusDetail?.description || 'Unknown';
    const deliveredAt = trackResult.actualDeliveryTime || null;
    const estimatedDelivery = trackResult.estimatedDeliveryTimeWindow?.window?.ends || null;
    const location = trackResult.latestStatusDetail?.scanLocation?.city || null;

    const statusMap = {
      'DL': 'Delivered',
      'OD': 'Out for Delivery',
      'IT': 'In Transit',
      'PU': 'Picked Up',
      'PX': 'Picked Up',
      'OC': 'Label Created',
      'DE': 'Delivery Exception',
      'RS': 'Return to Sender',
      'HL': 'Hold at Location'
    };

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        code: statusCode,
        status: statusMap[statusCode] || statusDesc,
        deliveredAt,
        estimatedDelivery,
        location
      })
    };

  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
