import { ADYNTEL_API_KEY, ADYNTEL_EMAIL } from '../config';

export async function getAdVolumeByCountry(domain: string): Promise<{ 
  facebook: { spendByCountry: Record<string, number>; count: number; totalSpend: number; }, 
  google: { spendByCountry: Record<string, number>; count: number; totalSpend: number; } 
}> {
  const adVolume = { 
    facebook: { spendByCountry: {} as Record<string, number>, count: 0, totalSpend: 0 }, 
    google: { spendByCountry: {} as Record<string, number>, count: 0, totalSpend: 0 } 
  };

  if (!ADYNTEL_API_KEY) {
    throw new Error('ADYNTEL_API_KEY is not set in the environment variables.');
  }
  if (!ADYNTEL_EMAIL) {
    throw new Error('ADYNTEL_EMAIL is not set in the environment variables.');
  }

  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 30000); // Increased timeout to 30s for slow API responses

    const headers = {
      'Authorization': `Bearer ${ADYNTEL_API_KEY}`,
      'Content-Type': 'application/json'
    };

    const fetchAdData = async (endpoint: string, body: any) => {
      const res = await fetch(`https://api.adyntel.com/${endpoint}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      }
      if (res.status === 204) {
        return null;
      }
      return await res.json();
    };

    // Fetch from Facebook and Google endpoints in parallel
    const requestBody = {
      api_key: ADYNTEL_API_KEY,
      email: ADYNTEL_EMAIL,
      company_domain: domain,
    };

    // To get regional localization for Facebook, we MUST query country_code explicitly
    // since the 'ALL' query doesn't breakdown the response by country.
    const TARGET_COUNTRIES = ['US', 'GB', 'CA', 'AU', 'DE', 'FR', 'IT', 'ES'];
    const fbPromises = TARGET_COUNTRIES.map(country => 
      fetchAdData('facebook', { ...requestBody, country_code: country, active_status: 'active' })
        .then(data => ({ country, data }))
    );

    const [fbResults, googleData] = await Promise.all([
      Promise.all(fbPromises),
      fetchAdData('google', requestBody)
    ]);
    
    clearTimeout(id);

    // Process Google
    const volG = adVolume.google;
    if (googleData && typeof googleData.total_ad_count === 'number' && googleData.total_ad_count > 0) {
      volG.count = googleData.total_ad_count;
      volG.totalSpend = 0; // Removing fake revenue
      
      const validRegions = new Set<string>();
      const jsonString = JSON.stringify(googleData);
      
      // Extract ANY ?region=XX from the entire JSON response
      const regex = /[?&]region=([A-Za-z]{2})(?:[^A-Za-z]|$)/g;
      let match;
      while ((match = regex.exec(jsonString)) !== null) {
        const code = match[1].toUpperCase();
        if (code !== 'AN') { // Ignore 'anywhere' partial match
          validRegions.add(code);
        }
      }

      if (validRegions.size > 0) {
        for (const region of validRegions) {
          volG.spendByCountry[region] = 1; // Assign dummy value > 0 so orchestrator loop works
        }
      } else {
        const fallbackRegion = googleData.country_code === 'anywhere' ? 'Global' : (googleData.country_code || 'US');
        volG.spendByCountry[fallbackRegion] = 1; 
      }
    }

    // Process Facebook across the queried countries
    const volF = adVolume.facebook;
    let hasFbData = false;
    for (const res of fbResults) {
      if (res.data && typeof res.data.number_of_ads === 'number' && res.data.number_of_ads > 0) {
        hasFbData = true;
        volF.count += res.data.number_of_ads;
        const estSpend = res.data.number_of_ads * 1000;
        volF.totalSpend += estSpend;
        volF.spendByCountry[res.country] = estSpend;
      }
    }
    
    // Fallback if the regional queries failed but we somehow got a general data payload
    if (!hasFbData && fbResults.length > 0 && fbResults[0].data && fbResults[0].data.spendByCountry) {
      volF.count = fbResults[0].data.number_of_ads || 0;
      for (const [country, spend] of Object.entries(fbResults[0].data.spendByCountry as Record<string, number>)) {
        const numSpend = Number(spend);
        volF.spendByCountry[country] = (volF.spendByCountry[country] || 0) + numSpend;
        volF.totalSpend += numSpend;
      }
    }

  } catch (err) {
    console.error(`[Adyntel] Orchestration failed for ${domain}: ${String(err)}`);
    throw err;
  }

  return adVolume;
}
