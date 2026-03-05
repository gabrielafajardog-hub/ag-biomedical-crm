// Netlify Function — FedEx Tracking Proxy
const FEDEX_API_KEY = 'l78b74564b8d2a4879bcd7a1e4347715a3';
const FEDEX_SECRET_KEY = 'e636f244800046e4aa686b2b620f56d3';
const FEDEX_BASE = 'https://apis.fedex.com';

async function getToken() {
  const res = await fetch(`${FEDEX_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=client_credentials&client_id=${FEDEX_API_KEY}&client_secret=${FEDEX_SECRET_KEY}`
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Failed to get FedEx token: ' + JSON.stringify(data));
  return data.access_token;
}

async function trackPackage(token, trackingNumber) {
  const res = await fetch(`${FEDEX_BASE}/track/v1/trackingnumbers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-locale': 'en_US'
    },
    body: JSON.stringify({
      includeDetailedScans: true,
      trackingInfo: [{ trackingNumberInfo: { trackingNumber } }]
    })
  });
  return await res.json();
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  try {
    const { trackingNumber } = JSON.parse(event.body || '{}');
    if (!trackingNumber) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'trackingNumber required' }) };
    }

    const token = await getToken();
    const result = await trackPackage(token, trackingNumber);

    const output = result?.output?.completeTrackResults?.[0]?.trackResults?.[0];
    if (!output) {
      return { statusCode: 200, headers, body: JSON.stringify({ status: 'Unknown', detail: 'No results found' }) };
    }

    const status = output.latestStatusDetail?.description || 'Unknown';
    const code = output.latestStatusDetail?.code || '';
    const location = output.latestStatusDetail?.scanLocation?.city
      ? `${output.latestStatusDetail.scanLocation.city}, ${output.latestStatusDetail.scanLocation.stateOrProvinceCode}`
      : '';
    const estimatedDelivery = output.estimatedDeliveryTimeWindow?.window?.ends || '';

    // Get actual delivery date/time if delivered
    let deliveredAt = '';
    if (code === 'DL') {
      const scans = output.scanEvents || [];
      const dlScan = scans.find(s => s.eventType === 'DL');
      if (dlScan) deliveredAt = dlScan.date || '';
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ status, code, location, estimatedDelivery, deliveredAt })
    };

  } catch (err) {
    console.error('FedEx error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
