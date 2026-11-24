<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import { Building2, Pencil, Plus, Save, Search, Trash2, X } from 'lucide-svelte';
  import { api } from '$lib/api';
  const desk = getContext<any>('order-desk');

  type CustomerProfile = {
    id: string; name: string; tax_no: string; contact: string; phone: string;
    address: string; bank_name: string; bank_account: string; note: string;
  };
  type CustomerForm = Omit<CustomerProfile, 'id'>;
  const emptyForm = (): CustomerForm => ({ name: '', tax_no: '', contact: '', phone: '', address: '', bank_name: '', bank_account: '', note: '' });

  let profiles = $state<CustomerProfile[]>([]);
  let loading = $state(true);
  let saving = $state(false);
  let error = $state('');
  let success = $state('');
  let search = $state('');
  let formOpen = $state(false);
  let editingId = $state('');
  let form = $state<CustomerForm>(emptyForm());

  const visibleProfiles = $derived(profiles.filter((profile) => {
    const keyword = search.trim().toLowerCase();
    return !keyword || `${profile.name} ${profile.tax_no} ${profile.contact} ${profile.phone}`.toLowerCase().includes(keyword);
  }));

  async function loadProfiles() {
    try {
      const result = await api.get<{ data: CustomerProfile[] }>('/api/customer-profiles');
      profiles = result.data;
    } catch (reason) {
      error = reason instanceof Error ? reason.message : '客户资料加载失败';
    } finally {
      loading = false;
    }
  }
  function startCreate() {
    error = ''; success = ''; editingId = ''; form = emptyForm(); formOpen = true;
  }
  function startEdit(profile: CustomerProfile) {
    error = ''; success = ''; editingId = profile.id;
    form = { name: profile.name, tax_no: profile.tax_no, contact: profile.contact, phone: profile.phone, address: profile.address, bank_name: profile.bank_name, bank_account: profile.bank_account, note: profile.note };
    formOpen = true;
  }
  function cancelForm() {
    if (saving) return;
    error = ''; editingId = ''; form = emptyForm(); formOpen = false;
  }
  async function save() {
    if (saving) return;
    if (!form.name.trim()) { error = '请填写客户名称'; return; }
    saving = true; error = ''; success = '';
    try {
      if (editingId) await api.patch('/api/customer-profiles', { id: editingId, ...form });
      else await api.post('/api/customer-profiles', { ...form });
      await loadProfiles();
      success = editingId ? '客户资料已保存' : '客户已新增';
      formOpen = false; editingId = ''; form = emptyForm();
    } catch (reason) {
      error = reason instanceof Error ? reason.message : '客户资料保存失败';
    } finally {
      saving = false;
    }
  }
  async function remove(profile: CustomerProfile) {
    if (saving) return;
    if (!await desk.requestConfirm('删除客户', `确定删除客户「${profile.name}」？该操作只删除客户资料，不影响其他业务数据。`)) return;
    saving = true; error = ''; success = '';
    try {
      await api.delete('/api/customer-profiles', { id: profile.id });
      profiles = profiles.filter((item) => item.id !== profile.id);
      if (editingId === profile.id) cancelForm();
      success = '客户已删除';
    } catch (reason) {
      error = reason instanceof Error ? reason.message : '客户删除失败';
    } finally {
      saving = false;
    }
  }

  onMount(loadProfiles);
</script>

<aside class="customer-manager" aria-labelledby="customer-manager-title">
  <div class="customer-manager-head">
    <div>
      <h3 id="customer-manager-title"><Building2 size={16} />客户管理</h3>
      <span>独立维护客户开票资料，暂不与订单、报价关联</span>
    </div>
    {#if desk.canManageCatalog && !formOpen}
      <button class="mini-create" type="button" title="新增客户" onclick={startCreate}><Plus size={15} />新增</button>
    {/if}
  </div>

  {#if error}<p class="customer-message error" role="alert">{error}</p>{/if}
  {#if success}<p class="customer-message success" role="status">{success}</p>{/if}

  {#if formOpen}
    <form class="customer-form" onsubmit={(event) => { event.preventDefault(); save(); }}>
      <div class="customer-form-head">
        <b>{editingId ? '编辑客户' : '新增客户'}</b>
        <button class="icon-control" type="button" title="关闭" aria-label="关闭客户表单" disabled={saving} onclick={cancelForm}><X size={16} /></button>
      </div>
      <label>客户名称 <em>*</em><input bind:value={form.name} maxlength="80" placeholder="例如：华东科技有限公司" required disabled={saving} /></label>
      <label>税号<input bind:value={form.tax_no} maxlength="40" placeholder="统一社会信用代码" disabled={saving} /></label>
      <label>联系人<input bind:value={form.contact} maxlength="40" placeholder="开票联系人" disabled={saving} /></label>
      <label>电话<input bind:value={form.phone} maxlength="40" placeholder="联系电话" disabled={saving} /></label>
      <label>地址<input bind:value={form.address} maxlength="160" placeholder="开票地址" disabled={saving} /></label>
      <label>开户银行<input bind:value={form.bank_name} maxlength="80" placeholder="开户行名称" disabled={saving} /></label>
      <label>银行账号<input bind:value={form.bank_account} maxlength="60" placeholder="对公账号" disabled={saving} /></label>
      <label>备注<textarea bind:value={form.note} maxlength="300" rows="2" placeholder="其他开票信息" disabled={saving}></textarea></label>
      <div class="customer-form-actions">
        <button class="outline-action" type="button" disabled={saving} onclick={cancelForm}>取消</button>
        <button class="primary-action" type="submit" disabled={saving || !form.name.trim()}><Save size={15} />{saving ? '保存中...' : '保存'}</button>
      </div>
    </form>
  {:else}
    <label class="search-field customer-search"><Search size={15} /><input bind:value={search} placeholder="搜索客户名称 / 税号" /></label>
    <div class="customer-list">
      {#each visibleProfiles as profile (profile.id)}
        <div class="customer-card">
          <div class="customer-card-copy">
            <b title={profile.name}>{profile.name}</b>
            <span title={profile.tax_no || '未填写税号'}>{profile.tax_no || '未填写税号'}</span>
            {#if profile.contact || profile.phone}<small>{[profile.contact, profile.phone].filter(Boolean).join(' · ')}</small>{/if}
          </div>
          {#if desk.canManageCatalog}
            <div class="customer-card-actions">
              <button class="icon-control" type="button" title="编辑" aria-label={`编辑客户 ${profile.name}`} onclick={() => startEdit(profile)}><Pencil size={15} /></button>
              <button class="delete-action" type="button" title="删除" aria-label={`删除客户 ${profile.name}`} disabled={saving} onclick={() => remove(profile)}><Trash2 size={15} /></button>
            </div>
          {/if}
        </div>
      {:else}
        <div class="customer-empty">{loading ? '加载中...' : search ? '没有匹配的客户。' : '暂无客户，点击“新增”添加。'}</div>
      {/each}
    </div>
  {/if}
</aside>
