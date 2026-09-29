export function loadBrowseState(key) {
  try {const state=JSON.parse(sessionStorage.getItem('browse:'+key));return state&&Date.now()-state.at<3600000?state:null;}catch{return null;}
}
export function saveBrowseState(key,value) {
  try {sessionStorage.setItem('browse:'+key,JSON.stringify({...value,at:Date.now()}));}catch{}
}
