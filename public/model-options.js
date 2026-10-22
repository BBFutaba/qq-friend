// Selection rules shared by all persona and background-agent dropdowns.
export function modelOptions(catalog, currentModel, currentEffort) {
  if (!catalog) return {
    models: [{ id: currentModel, name: `${currentModel || '本地默认模型'}（待检测）` }],
    model: currentModel, efforts: currentEffort ? [currentEffort] : [], effort: currentEffort,
    canSelectModel: false, canSelectEffort: false, note: '检测后可选择模型及对应的推理强度',
  };
  const models = catalog.models.map(m => ({ ...m }));
  let model = models.find(m => m.id === currentModel);
  if (!model && !currentModel) model = models.find(m => m.isDefault);
  if (!model) return {
    models: [{ id: currentModel, name: `${currentModel || '本地默认模型'}（当前配置，未在检测结果中）`, unavailable: true }, ...models],
    model: currentModel, efforts: currentEffort ? [currentEffort] : [], effort: currentEffort,
    canSelectModel: models.length > 0, canSelectEffort: false,
    note: '当前模型未在检测结果中，已保留原配置；请选择可用模型',
  };
  const efforts = [...new Set((model.efforts || []).filter(e => typeof e === 'string' && e))];
  const effort = efforts.includes(currentEffort) ? currentEffort
    : efforts.includes(model.defaultEffort) ? model.defaultEffort
    : efforts.includes('medium') ? 'medium' : efforts[0] || '';
  return {
    models, model: model.id, efforts, effort, canSelectModel: models.length > 0,
    canSelectEffort: efforts.length > 0,
    note: !efforts.length ? '此模型未提供可选推理强度，使用本地默认设置'
      : currentEffort && effort !== currentEffort ? `原强度 ${currentEffort} 不适用，已选择 ${effort}；保存后生效` : '',
  };
}
