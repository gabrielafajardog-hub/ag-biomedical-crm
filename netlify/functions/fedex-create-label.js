// Netlify Function — FedEx Create Label
const FEDEX_API_KEY = 'l7d57c796ad60049809cff29a676e5be30';
const FEDEX_SECRET_KEY = '5d034655541c4efea852a99431bea722';
const FEDEX_ACCOUNT = '740561073';
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

exports.handler = async (event) => {
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
    const {
      jobId,
      facilityName,
      recipientName,
      recipientPhone,
      street,
      city,
      state,
      zip,
      serviceType,
      weight,
      length,
      width,
      height
    } = JSON.parse(event.body);

    const token = await getToken();

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
            streetLines: ['8250 NW 27th St', 'Suite 201'],
            city: 'Miami',
            stateOrProvinceCode: 'FL',
            postalCode: '33122',
            countryCode: 'US'
          }
        },
        recipients: [{
          contact: {
            personName: recipientName || 'Biomed Department',
            phoneNumber: recipientPhone || '0000000000',
            companyName: facilityName || ''
          },
          address: {
            streetLines: [street || ''],
            city: city || '',
            stateOrProvinceCode: state || '',
            postalCode: zip || '',
            countryCode: 'US'
          }
        }],
        shipDatestamp: new Date().toISOString().split('T')[0],
        serviceType: serviceType || 'FEDEX_GROUND',
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
            value: weight || 5
          },
          dimensions: {
            length: length || 12,
            width: width || 12,
            height: height || 8,
            units: 'IN'
          },
          customerReferences: [{
            customerReferenceType: 'CUSTOMER_REFERENCE',
            value: jobId || ''
          }]
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
      console.error('FedEx error:', JSON.stringify(data));
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: data?.errors?.[0]?.message || 'FedEx error', details: data })
      };
    }

    const shipment = data?.output?.transactionShipments?.[0];
    const trackingNumber = shipment?.masterTrackingNumber;
    const labelUrl = shipment?.pieceResponses?.[0]?.packageDocuments?.[0]?.url;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ trackingNumber, labelUrl })
    };

  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
