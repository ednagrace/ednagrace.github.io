import { byId } from './format.js';

/* ---------- Leitura por foto: utilitários compartilhados ----------
   Usados pelo formulário do relatório (screens/form.ts) e pelo cadastro de
   cliente (components/contatoSheet.ts). */

// Reduz a imagem antes de enviar: upload menor, resposta mais rápida/barata e sem
// esbarrar no limite de tamanho da função serverless. 'from-image' respeita a
// orientação EXIF (foto deitada não vira de lado). Devolve o JPEG em base64 (sem
// o prefixo data:).
export async function downscalePhoto(
  file: File, maxDim = 1568, quality = 0.82,
): Promise<string> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return canvas.toDataURL('image/jpeg', quality).split(',')[1] || '';
}

// Liga os dois botões (câmera / galeria) a um <input type="file"> escondido.
// `capture` liga a câmera; sem ele, abre a galeria/arquivos — trocado na hora do
// clique, porque deixar o sistema "escolher" abre direto a galeria em vários
// aparelhos. `input.value=''` depois de cada escolha permite repicar o mesmo
// arquivo.
export function wirePhotoPicker(opts: {
  camBtnId: string; galleryBtnId: string; fileId: string;
  onPick: (file: File) => void;
}) {
  const file = byId(opts.fileId) as HTMLInputElement | null;
  const cam = byId(opts.camBtnId);
  const gallery = byId(opts.galleryBtnId);
  const open = (useCamera: boolean) => {
    if (!file) return;
    if (useCamera) file.setAttribute('capture', 'environment');
    else file.removeAttribute('capture');
    file.click();
  };
  if (cam) cam.onclick = () => open(true);
  if (gallery) gallery.onclick = () => open(false);
  if (file) file.onchange = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const f = input.files && input.files[0];
    input.value = '';
    if (f) opts.onPick(f);
  };
}
