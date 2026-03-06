// Netlify Function — FedEx Create Label (SANDBOX / TEST MODE)
const FEDEX_API_KEY = 'l78232c718dce94da0998ef8df27d67a5a';
const FEDEX_SECRET_KEY = 'e4e5d99030b4485a995d7ac5b276f80c';
const FEDEX_ACCOUNT = '740561073';
const FEDEX_BASE = 'https://apis-sandbox.fedex.com';

async function getToken() {
  const res = await fetch(`${FEDEX_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=client_credentials&client_id=${FEDEX_API_KEY}&client_secret=${FEDEX_SECRET_KEY}`
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('FedEx auth failed: ' + JSON.stringify(data));
  return data.access_token;
}

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  try {
    // Frontend sends: { recipient: { name, company, phone, street, city, state, zip }, service, weight, description, jobId }
    const body = JSON.parse(event.body);
    const r = body.recipient || {};

    const recipientName    = r.name    || r.company || 'Recipient';
    const recipientCompany = r.company || '';
    const recipientPhone   = (r.phone  || '3055550000').replace(/\D/g, '');
    const street           = r.street  || '';
    const city             = r.city    || '';
    const state            = r.state   || '';
    const zip              = r.zip     || '';
    const serviceType      = body.service     || 'FEDEX_GROUND';
    const weight           = parseFloat(body.weight) || 5;
    const description      = body.description || 'Medical Equipment';
    const jobId            = body.jobId       || '';

    const token = await getToken();

    const shipDate = new Date();
    // FedEx won't accept same-day weekend dates — push to Monday if needed
    const day = shipDate.getDay();
    if (day === 0) shipDate.setDate(shipDate.getDate() + 1); // Sunday → Monday
    if (day === 6) shipDate.setDate(shipDate.getDate() + 2); // Saturday → Monday
    const shipDatestamp = shipDate.toISOString().split('T')[0];

    const shipmentBody = {
      labelResponseOptions: 'URL_ONLY',
      requestedShipment: {
        shipper: {
          contact: {
            personName: 'Shipping & Receiving',
            phoneNumber: '3055554444',
            companyName: 'A&G Biomedical'
          },
          address: {
            streetLines: ['3382 NW 151st Terr'],
            city: 'Miami Gardens',
            stateOrProvinceCode: 'FL',
            postalCode: '33054',
            countryCode: 'US'
          }
        },
        recipients: [{
          contact: {
            personName: recipientName,
            phoneNumber: recipientPhone,
            companyName: recipientCompany
          },
          address: {
            streetLines: [street],
            city: city,
            stateOrProvinceCode: state,
            postalCode: zip,
            countryCode: 'US'
          }
        }],
        shipDatestamp: shipDatestamp,
        serviceType: serviceType,
        packagingType: 'YOUR_PACKAGING',
        pickupType: 'DROPOFF_AT_FEDEX_LOCATION',
        shippingChargesPayment: {
          paymentType: 'SENDER',
          payor: {
            responsibleParty: {
              accountNumber: { value: FEDEX_ACCOUNT }
            }
          }
        },
        labelSpecification: {
          labelFormatType: 'COMMON2D',
          imageType: 'PDF',
          labelStockType: 'PAPER_4X6'
        },
        requestedPackageLineItems: [{
          weight: {
            units: 'LB',
            value: weight
          },
          dimensions: {
            length: 12,
            width: 12,
            height: 8,
            units: 'IN'
          },
          customerReferences: [
            {
              customerReferenceType: 'CUSTOMER_REFERENCE',
              value: jobId || description
            }
          ]
        }]
      },
      accountNumber: { value: FEDEX_ACCOUNT }
    };

    const res = await fetch(`${FEDEX_BASE}/ship/v1/shipments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'X-locale': 'en_US'
      },
      body: JSON.stringify(shipmentBody)
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('FedEx ship error:', JSON.stringify(data));
      const msg = data?.errors?.[0]?.message || data?.error || JSON.stringify(data);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: msg, raw: data })
      };
    }

    const shipment     = data?.output?.transactionShipments?.[0];
    const trackingNumber = shipment?.masterTrackingNumber;
    const labelUrl     = shipment?.pieceResponses?.[0]?.packageDocuments?.[0]?.url;

    if (!trackingNumber || !labelUrl) {
      console.error('Missing tracking/label in response:', JSON.stringify(data));
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Label created but could not extract tracking number or URL', raw: data })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ trackingNumber, labelUrl })
    };

  } catch (err) {
    console.error('Function error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
