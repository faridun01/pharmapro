type RuntimeMarkDetails = Record<string, unknown>;

const getMarkStore = (): Record<string, boolean> => {
  const runtimeWindow = window as Window & {
    __pharmaproRuntimeMarks?: Record<string, boolean>;
  };

  if (!runtimeWindow.__pharmaproRuntimeMarks) {
    runtimeWindow.__pharmaproRuntimeMarks = {};
  }

  return runtimeWindow.__pharmaproRuntimeMarks;
};

export const markRuntimeOnce = (name: string, details?: RuntimeMarkDetails) => {
  if (typeof window === 'undefined') {
    return;
  }

  const markStore = getMarkStore();
  if (markStore[name]) {
    return;
  }

  markStore[name] = true;
  window.pharmaproDesktop?.markRuntime?.(name, details);
};