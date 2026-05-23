const root = document.documentElement;
root.style.colorScheme = 'dark';
root.style.fontFamily = 'sans-serif';

document.body.style.margin = '0';
document.body.style.background = '#0d1321';
document.body.style.color = '#f4f7fb';

const main = document.querySelector('main');
if (main) {
  Object.assign(main.style, {
    display: 'grid',
    gap: '12px',
    padding: '24px',
  });
}
