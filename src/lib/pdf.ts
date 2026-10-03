// تحويل عنصر من الصفحة إلى ملف PDF بمقاس A4 وتنزيله مباشرة (يعمل في المتصفح فقط)

export async function downloadElementAsPdf(element: HTMLElement, fileName: string) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);

  const canvas = await html2canvas(element, {
    scale: 2,
    backgroundColor: "#ffffff",
    useCORS: true,
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
