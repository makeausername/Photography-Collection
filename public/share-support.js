export function shareEnvironment(userAgent, hasShare, secure) {
  return { wechat: /MicroMessenger/i.test(userAgent), native: Boolean(hasShare && secure) };
}
export async function sendToSystem(navigatorAPI, data) {
  try {
    if(typeof navigatorAPI.share!=='function' || (navigatorAPI.canShare && !navigatorAPI.canShare(data)))return 'unavailable';
    await navigatorAPI.share(data);
    // A resolved promise may mean only that the system picker opened.
    return 'opened';
  } catch(error) { return error.name==='AbortError'?'cancelled':'unavailable'; }
}
