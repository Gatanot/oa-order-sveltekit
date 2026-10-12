<script lang="ts">
  import { Search, X } from 'lucide-svelte';
  type Filter = { key: string; label: string; value: string; type?: 'search' | 'date-range'; placeholder?: string; options?: { value: string; label: string }[]; endKey?: string; endValue?: string };
  let { fields, onchange, onclear, label = '列表筛选', disabled = false }: { fields: Filter[]; onchange: (key: string, value: string) => void; onclear: () => void; label?: string; disabled?: boolean } = $props();
  const chips = $derived(fields.flatMap((field) => [
    ...(field.value ? [{ key: field.key, label: field.type === 'date-range' ? '开始日期' : field.label, text: field.options?.find((option) => option.value === field.value)?.label || field.value }] : []),
    ...(field.endValue && field.endKey ? [{ key: field.endKey, label: '结束日期', text: field.endValue }] : []),
  ]));
</script>

<fieldset class="workbench-list-filters" aria-label={label} {disabled}>
  <div class="workbench-filter-primary">
    {#each fields as field}
      <div class="field" class:filter-search={field.type === 'search'} class:workbench-date-field={field.type === 'date-range'}>
        <label for={`filter-${field.key}`}>{field.label}</label>
        {#if field.type === 'search'}
          <div class="search-field"><Search size={16} /><input id={`filter-${field.key}`} value={field.value} placeholder={field.placeholder} oninput={(event) => onchange(field.key, event.currentTarget.value)} /></div>
        {:else if field.type === 'date-range'}
          <div class="order-date-range" role="group" aria-label={field.label}>
            <input id={`filter-${field.key}`} class="date-input" type="date" aria-label="开始日期" value={field.value} oninput={(event) => onchange(field.key, event.currentTarget.value)} /><span aria-hidden="true">至</span><input class="date-input" type="date" aria-label="结束日期" value={field.endValue} oninput={(event) => onchange(field.endKey!, event.currentTarget.value)} />
          </div>
        {:else}
          <select id={`filter-${field.key}`} value={field.value} onchange={(event) => onchange(field.key, event.currentTarget.value)}>{#each field.options || [] as option}<option value={option.value}>{option.label}</option>{/each}</select>
        {/if}
      </div>
    {/each}
    <button class="outline-action filter-clear" type="button" disabled={!chips.length} onclick={onclear}>清空筛选</button>
  </div>
  {#if chips.length}
    <div class="order-filter-chips" aria-label="已生效筛选">{#each chips as chip}<button class="order-filter-chip" type="button" aria-label={`移除${chip.label}筛选：${chip.text}`} title={`${chip.label}：${chip.text}`} onclick={() => onchange(chip.key, '')}><span>{chip.label}：{chip.text}</span><X size={13} /></button>{/each}</div>
  {/if}
</fieldset>
