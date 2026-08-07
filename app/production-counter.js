// Rollback de segurança: a camada visual do contador está temporariamente desativada.
// O backend e os dados do contador permanecem preservados para uma reimplementação isolada.
// Este módulo não observa, altera ou recria elementos do DOM e não intercepta eventos do operador.
export const PRODUCTION_COUNTER_UI_ENABLED = false;
