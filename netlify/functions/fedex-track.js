const https = require('https');

function fetchUrl(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getToken() {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.FEDEX_CLIENT_ID,
    client_secret: process.env.FEDEX_CLIENT_SECRET
  }).toString();

  const res = await fetchUrl({
    hostname: 'apis-sandbox.fedex.com',
    path: '/oauth/token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body)
    }
  }, body);

  console.log('Token response status:', res.status);
  console.log('Token response body:', res.body.slice(0, 300));
  const parsed = JSON.parse(res.body);
  return parsed;
}

async function trackPackage(token, trackingNumber) {
  const body = JSON.stringify({
    includeDetailedScans: true,
    trackingInfo: [{ trackingNumberInfo: { trackingNumber } }]
  });

  const res = await fetchUrl({
    hostname: 'apis-sandbox.fedex.com',
    path: '/track/v1/trackingnumbers',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-locale': 'en_US',
      'Content-Length': Buffer.byteLength(body)
    }
  }, body);

  console.log('Track response status:', res.status);
  console.log('Track response body:', res.body.slice(0, 500));
  return JSON.parse(res.body);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' } };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { trackingNumber } = JSON.parse(event.body);
    if (!trackingNumber) return { statusCode: 400, body: JSON.stringify({ error: 'No tracking number' }) };

    const tn = trackingNumber.trim().split(/\s+/)[0];
    console.log('Tracking number:', tn);
    console.log('ENV check - client_id present:', !!process.env.FEDEX_CLIENT_ID);
    console.log('ENV check - client_secret present:', !!process.env.FEDEX_CLIENT_SECRET);

    const tokenData = await getToken();
    if (!tokenData.access_token) {
      console.log('Token failed:', JSON.stringify(tokenData));
      return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Auth failed: ' + JSON.stringify(tokenData) }) };
    }

    const result = await trackPackage(tokenData.access_token, tn);

    const trackResult = result?.output?.completeTrackResults?.[0]?.trackResults?.[0];
    if (!trackResult) {
      console.log('No track result. Full response:', JSON.stringify(result).slice(0, 500));
      return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'No tracking data returned' }) };
    }

    const statusCode = trackResult.latestStatusDetail?.code || '';
    const statusDesc = trackResult.latestStatusDetail?.description || 'Unknown';
    const deliveredAt = trackResult.actualDeliveryTime || null;
    const estimatedDelivery = trackResult.estimatedDeliveryTimeWindow?.window?.ends || null;
    const location = trackResult.latestStatusDetail?.scanLocation?.city || null;

    const statusMap = {
      'DL': 'Delivered', 'OD': 'Out for Delivery', 'IT': 'In Transit',
      'PU': 'Picked Up', 'PX': 'Picked Up', 'OC': 'Label Created',
      'DE': 'Delivery Exception', 'RS': 'Return to Sender', 'HL': 'Hold at Location',
      'AR': 'Arrived', 'DP': 'Departed'
    };

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        code: statusCode,
        status: statusMap[statusCode] || statusDesc,
        deliveredAt, estimatedDelivery, location
      })
    };

  } catch (err) {
    console.error('Track error:', err.message, err.stack);
    return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: err.message }) };
  }
};
