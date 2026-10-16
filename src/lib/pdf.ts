// تحويل عنصر من الصفحة إلى ملف PDF بمقاس A4 وتنزيله مباشرة (يعمل في المتصفح فقط)
// html2canvas-pro بدل html2canvas: ألوان Tailwind v4 مكتوبة بـ oklch() والأصلية ترمي خطأ عند قراءتها.

export async function downloadElementAsPdf(element: HTMLElement, fileName: string) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas-pro"),
    import("jspdf"),
  ]);

  // Let a node the caller just mounted get laid out and painted before it is measured.
  await nextFrame();
  await nextFrame();
  await loadFontsFor(document, element);
  const width = element.getBoundingClientRect().width;
  const canvas = await html2canvas(element, {
    scale: 2,
    backgroundColor: "#ffffff",
    useCORS: true,
    onclone: (clone, cloned) => prepareClone(clone, cloned, width),
  });

  const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 24;
  const usableWidth = pageWidth - margin * 2;
  const imageHeight = (canvas.height * usableWidth) / canvas.width;
  const image = canvas.toDataURL("image/jpeg", 0.95);

  if (imageHeight <= pageHeight - margin * 2) {
    pdf.addImage(image, "JPEG", margin, margin, usableWidth, imageHeight);
  } else {
    let remaining = imageHeight;
    let position = margin;
    while (remaining > 0) {
      pdf.addImage(image, "JPEG", margin, position, usableWidth, imageHeight);
      remaining -= pageHeight - margin * 2;
      if (remaining > 0) {
        pdf.addPage();
        position = position - (pageHeight - margin * 2);
      }
    }
  }

  pdf.save(fileName.endsWith(".pdf") ? fileName : `${fileName}.pdf`);
}

// الرسم يتم داخل نسخة من الصفحة في iframe: أوراق الأنماط والخطوط فيها تُحمّل من جديد ولا يُنتظر اكتمالها،
// فتُقاس الكلمات بخط بديل (أو بلا أنماط أصلًا) وتُرسم بالخط الحقيقي، فتتداخل أو تتباعد. لذا ننتظر صراحةً:
// أوراق الأنماط في النسخة، ثم كل خط يستخدمه العنصر لحروف نصّه، في الصفحة (حيث يُرسم) وفي النسخة (حيث يُقاس).
async function loadFontsFor(doc: Document, root: Element) {
  const view = doc.defaultView;
  if (!view) return;
  const fonts = new Set<string>();
  for (const el of [root, ...root.querySelectorAll("*")]) {
    const cs = view.getComputedStyle(el);
    fonts.add(`${cs.fontStyle} ${cs.fontWeight} 16px ${cs.fontFamily}`);
  }
  const text = [...new Set(root.textContent ?? "")].join("") || " ";
  await Promise.all([...fonts].map((f) => doc.fonts.load(f, text).catch(() => undefined)));
  await doc.fonts.ready;
}

async function stylesheetsLoaded(doc: Document) {
  const links = [...doc.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]')];
  await Promise.all(
    links
      .filter((link) => !link.sheet)
      .map(
        (link) =>
          new Promise<void>((resolve) => {
            const done = () => resolve();
            link.addEventListener("load", done, { once: true });
            link.addEventListener("error", done, { once: true });
            setTimeout(done, 5000);
          }),
      ),
  );
}

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

async function prepareClone(clone: Document, element: HTMLElement, width: number) {
  await stylesheetsLoaded(clone);
  await loadFontsFor(clone, element);
  // The clone is styled once the node has the width it has on the page; an unstyled clone lays it
  // out at the full window width. Better a clear failure than a PDF without the app's styles.
  const deadline = Date.now() + 5000;
  while (Math.abs(element.getBoundingClientRect().width - width) > 1) {
    if (Date.now() > deadline) throw new Error("PDF capture: the page styles did not load in time");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
