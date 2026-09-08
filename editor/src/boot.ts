// Placeholder entry: keeps the Vite pipeline honest until the UI wave lands.
declare const __COMMIT__: string;

document.querySelector('#app')?.insertAdjacentHTML('beforeend', `<p>build ${__COMMIT__}</p>`);
