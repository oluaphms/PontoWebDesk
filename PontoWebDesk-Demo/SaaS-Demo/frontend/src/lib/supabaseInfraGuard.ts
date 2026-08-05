let infraFatalMessage: string | null = null;

export function setSupabaseInfraFatal(message: string): void {
  infraFatalMessage = message;
}

export function getSupabaseInfraFatal(): string | null {
  return infraFatalMessage;
}

export function showFatalError(message: string): void {
  if (typeof document === 'undefined') return;
  let root = document.getElementById('root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);
  }
  root.replaceChildren();
  const wrapper = document.createElement('div');
  wrapper.style.display = 'flex';
  wrapper.style.height = '100vh';
  wrapper.style.alignItems = 'center';
  wrapper.style.justifyContent = 'center';
  wrapper.style.fontFamily = 'system-ui,-apple-system,sans-serif';
  wrapper.style.background = '#0f172a';
  wrapper.style.color = '#fff';
  wrapper.style.padding = '24px';
  wrapper.style.textAlign = 'center';

  const content = document.createElement('div');
  content.style.maxWidth = '640px';

  const title = document.createElement('h1');
  title.style.margin = '0 0 12px 0';
  title.textContent = 'Erro de Conexao';

  const text = document.createElement('p');
  text.style.margin = '0';
  text.style.lineHeight = '1.5';
  text.textContent = String(message);

  content.appendChild(title);
  content.appendChild(text);
  wrapper.appendChild(content);
  root.appendChild(wrapper);
}

