const $ = s => document.querySelector(s);
const make = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
let state, portfolio, editingId, deletingId, previewUrl, saving = false;
async function api(url, options = {}) {
  const response = await fetch(url, options);
  let value; try { value = await response.json(); } catch { throw Error('服务器暂时无法响应，请稍后重试'); }
  if (!response.ok) { if (response.status === 401 && !url.endsWith('/login')) { $('#dashboard').hidden = true; $('#login-screen').hidden = false; } throw Error(value.error || '操作失败，请重试'); }
  return value;
}
const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; setTimeout(() => $('#toast').hidden = true, 3500); }
function message(target, text, ok = false) { target.textContent = text; target.classList.toggle('success', ok); }
async function init() {
  try {
    state = await api('/api/session');
    if (state.authenticated) return dashboard();
    $('#login-screen').hidden = false;
    if (state.setupRequired) {
      $('#login-title').textContent = '创建管理员密码'; $('#login-button').textContent = '设置密码并进入';
      $('#login-note').textContent = state.canSetup ? '这是第一次使用。设置一个至少 12 个字符的密码，之后只有你能管理作品。' : '请在服务器本机访问后台完成首次设置，或配置 ADMIN_PASSWORD 后重启。';
      $('#login-password').minLength = 12; $('#login-password').autocomplete = 'new-password'; $('#login-button').disabled = !state.canSetup;
    }
  } catch (e) { message($('#login-message'), e.message); }
}
$('#login-form').onsubmit = async event => {
  event.preventDefault(); const button = $('#login-button'); button.disabled = true;
  try { await api(state.setupRequired ? '/api/setup' : '/api/login', json('POST', { password: $('#login-password').value })); $('#login-form').reset(); await dashboard(); }
  catch (e) { message($('#login-message'), e.message); } finally { button.disabled = false; }
};
async function dashboard() {
  portfolio = await api('/api/portfolio'); $('#login-screen').hidden = true; $('#dashboard').hidden = false;
  renderWorks(); for (const [key, value] of Object.entries(portfolio.settings)) if ($('#settings-form').elements[key]) $('#settings-form').elements[key].value = value;
}
function renderWorks() {
  $('#work-count').textContent = `${portfolio.works.length} 张作品 · ${portfolio.works.filter(w => w.kind === 'panorama').length} 张全景`;
  $('#admin-demo-note').hidden = !portfolio.works.some(w => w.demo);
  $('#category-list').replaceChildren(...[...new Set(portfolio.works.map(w => w.category))].map(c => { const o = make('option'); o.value = c; return o; }));
  $('#admin-works').replaceChildren(...portfolio.works.map(work => {
    const card = make('article', 'admin-card'), img = make('img'); img.src = work.preview; img.alt = work.title; img.loading = 'lazy';
    const body = make('div', 'admin-card-body'); body.append(make('span', 'tag', work.kind === 'panorama' ? '360° 全景' : work.category), make('h3', '', work.title), make('p', '', [work.location, work.year].filter(Boolean).join(' / ') || '未填写地点和时间'));
    if (work.demo) body.append(make('p', 'admin-card-credit', '演示素材 · ' + (work.credit || '')));
    const actions = make('div', 'admin-card-actions');
    for (const [label, action] of [['编辑信息', () => edit(work)], ['移至最前', async () => { try { await api(`/api/works/${work.id}/first`, json('POST', {})); await dashboard(); toast('已调整作品顺序'); } catch (e) { toast(e.message); } }], ['删除', () => { deletingId = work.id; $('#delete-description').textContent = work.title; message($('#delete-message'), ''); $('#delete-dialog').showModal(); }]]) { const b = make('button', '', label); b.onclick = action; actions.append(b); }
    body.append(actions); card.append(img, body); return card;
  }));
  if (!portfolio.works.length) $('#admin-works').append(make('p', 'empty-state', '还没有作品。点击“上传作品”添加第一张照片。'));
}
for (const button of document.querySelectorAll('[data-tab]')) button.onclick = () => { for (const item of document.querySelectorAll('[data-tab]')) item.classList.toggle('active', item === button); for (const panel of document.querySelectorAll('.admin-panel')) panel.hidden = panel.id !== button.dataset.tab; };
$('#logout').onclick = async () => { try { await api('/api/logout', json('POST', {})); location.reload(); } catch (e) { toast(e.message); } };
function edit(work = null) {
  editingId = work?.id || null; $('#work-form').reset(); $('#upload-fields').hidden = !!work; $('#photo-input').required = !work;
  $('#upload-public-note').hidden = !!work; $('#edit-title').textContent = work ? '编辑作品信息' : '上传作品';
  $('#upload-preview').hidden = true; $('#upload-caption').textContent = '点击选择照片'; $('#pano-upload-help').hidden = true; message($('#work-message'), '');
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  for (const key of ['title', 'category', 'location', 'year', 'description']) $('#work-form').elements[key].value = work?.[key] || '';
  $('#edit-dialog').showModal();
}
$('#new-work').onclick = () => edit();
for (const button of document.querySelectorAll('.close-edit')) button.onclick = () => { if (!saving) $('#edit-dialog').close(); };
$('#edit-dialog').addEventListener('cancel', event => { if (saving) event.preventDefault(); });
$('#edit-dialog').addEventListener('close', () => { if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = null; });
$('#photo-input').onchange = () => {
  const file = $('#photo-input').files[0]; if (!file) return;
  if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = URL.createObjectURL(file);
  $('#upload-preview').src = previewUrl; $('#upload-preview').hidden = false; $('#upload-caption').textContent = file.name;
  if (!$('#work-form').elements.title.value) $('#work-form').elements.title.value = file.name.replace(/\.[^.]+$/, '').slice(0, 80);
};
$('#work-kind').onchange = () => { $('#pano-upload-help').hidden = $('#work-kind').value !== 'panorama'; if ($('#work-kind').value === 'panorama' && !$('#work-form').elements.category.value) $('#work-form').elements.category.value = '360° 全景'; };
$('#work-form').onsubmit = async event => {
  event.preventDefault(); const button = $('#save-work'); button.disabled = true; saving = true; button.textContent = '正在保存…'; message($('#work-message'), '');
  try {
    const form = new FormData($('#work-form'));
    if (editingId) { const body = Object.fromEntries([...form.entries()].filter(([k]) => k !== 'photo')); await api(`/api/works/${editingId}`, json('PUT', body)); }
    else { if ($('#photo-input').files[0]?.size > 64 * 1024 * 1024) throw Error('图片不能超过 64 MB'); await api('/api/works', { method: 'POST', body: form }); }
    $('#edit-dialog').close(); await dashboard(); toast(editingId ? '作品信息已更新' : '作品已上传，访客现在可以看到了');
  } catch (e) { message($('#work-message'), e.message); }
  finally { saving = false; button.disabled = false; button.textContent = '保存作品'; }
};
$('#cancel-delete').onclick = () => $('#delete-dialog').close();
$('#confirm-delete').onclick = async () => {
  const button = $('#confirm-delete'); button.disabled = true;
  try { await api(`/api/works/${deletingId}`, { method: 'DELETE' }); $('#delete-dialog').close(); await dashboard(); toast('作品已删除'); }
  catch (e) { message($('#delete-message'), e.message); } finally { button.disabled = false; }
};
$('#settings-form').onsubmit = async event => {
  event.preventDefault(); const button = $('#settings-form button'); button.disabled = true;
  try { await api('/api/settings', json('PUT', Object.fromEntries(new FormData($('#settings-form'))))); message($('#settings-message'), '已保存，作品集页面刷新后即可看到变化。', true); }
  catch (e) { message($('#settings-message'), e.message); } finally { button.disabled = false; }
};
$('#password-form').onsubmit = async event => {
  event.preventDefault(); const form = Object.fromEntries(new FormData($('#password-form'))), button = $('#password-form button'); button.disabled = true;
  try { if (form.password !== form.confirm) throw Error('两次输入的新密码不一致'); await api('/api/password', json('POST', form)); $('#password-form').reset(); message($('#password-message'), '密码已更新。', true); }
  catch (e) { message($('#password-message'), e.message); } finally { button.disabled = false; }
};
init();
