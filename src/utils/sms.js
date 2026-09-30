function normalizeBangladeshNumber(mobile) {
  let phone = String(mobile || '').trim();

  if (!phone) return '';

  // Remove spaces, hyphens, brackets
  phone = phone.replace(/[\s\-()]/g, '');

  // +8801XXXXXXXXX -> 8801XXXXXXXXX
  if (phone.startsWith('+880')) {
    phone = phone.substring(1);
  }

  // 01XXXXXXXXX -> 8801XXXXXXXXX
  if (/^01\d{9}$/.test(phone)) {
    phone = `88${phone}`;
  }

  // 8801XXXXXXXXX
  if (/^8801\d{9}$/.test(phone)) {
    return phone;
  }

  return phone;
}

export async function sendSms(mobile, message) {
  const token = process.env.DNOTIFY_API_TOKEN;

  // Token check
  if (!token) {
    console.error('SMS ERROR: DNOTIFY_API_TOKEN is missing');

    return {
      success: false,
      message: 'DNOTIFY_API_TOKEN is not configured',
    };
  }

  // Mobile number
  const phone = normalizeBangladeshNumber(mobile);

  if (!phone) {
    console.error('SMS ERROR: Mobile number is missing');

    return {
      success: false,
      message: 'Mobile number is missing',
    };
  }

  // Message check
  if (!message || !String(message).trim()) {
    console.error('SMS ERROR: SMS message is empty');

    return {
      success: false,
      message: 'SMS message is empty',
    };
  }

  try {
    const apiUrl =
      process.env.DNOTIFY_API_URL ||
      'https://dnotify.net/api/v1/send-sms';

   

    const response = await fetch(apiUrl, {
      method: 'POST',

      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },

      body: JSON.stringify({
        mobile: phone,
        message: String(message),
      }),
    });

    // Try to read JSON response
    const contentType =
      response.headers.get('content-type') || '';

    let data = {};

    if (contentType.includes('application/json')) {
      data = await response.json().catch(() => ({}));
    } else {
      const text = await response.text().catch(() => '');
      data = {
        response: text,
      };
    }

    // Provider returned an error
    if (!response.ok) {
      console.error('DNotify SMS ERROR:', {
        status: response.status,
        statusText: response.statusText,
        response: data,
      });

      return {
        success: false,
        status: response.status,
        message:
          data?.message ||
          data?.error ||
          data?.response ||
          `SMS provider returned ${response.status}`,
        data,
      };
    }

  

    return {
      success: true,
      status: response.status,
      data,
    };

  } catch (error) {
    console.error('SMS REQUEST ERROR:', error);

    return {
      success: false,
      message: error?.message || 'SMS request failed',
    };
  }
}