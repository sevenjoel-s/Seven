import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';
import { CustomerOrder, FinancialTransaction, Meeting } from '../types/domain';

export function exportReportToPDF(
  title: string,
  subtitle: string,
  headers: string[],
  rows: Array<Array<string | number>>,
  filename = '7sunday-report.pdf'
) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  doc.setFontSize(18);
  doc.setTextColor(8, 43, 89); // Navy #082B59
  doc.text('7Sunday Meet — Seven Sunday Connect', 40, 44);

  doc.setFontSize(13);
  doc.setTextColor(21, 36, 58); // Dark text #15243A
  doc.text(title, 40, 68);

  doc.setFontSize(9);
  doc.setTextColor(41, 56, 88); // Body text #293858
  doc.text(`${subtitle} | Generated ${new Date().toLocaleString()}`, 40, 84);

  let y = 114;
  const colWidth = Math.max(80, Math.floor(760 / Math.max(1, headers.length)));

  doc.setFillColor(234, 244, 255); // Light blue #EAF4FF
  doc.rect(40, y - 14, 760, 22, 'F');
  doc.setFontSize(9);
  doc.setTextColor(8, 43, 89);
  headers.forEach((h, i) => {
    doc.text(String(h).slice(0, 22), 46 + i * colWidth, y);
  });

  y += 20;
  doc.setFontSize(8.5);
  rows.forEach((row, idx) => {
    if (y > 540) {
      doc.addPage();
      y = 48;
    }
    if (idx % 2 === 1) {
      doc.setFillColor(245, 248, 252); // Light bg #F5F8FC
      doc.rect(40, y - 12, 760, 18, 'F');
    }
    doc.setTextColor(41, 56, 88);
    row.forEach((cell, i) => {
      doc.text(String(cell ?? '').slice(0, 28), 46 + i * colWidth, y);
    });
    y += 18;
  });

  doc.save(filename);
}

export function exportDataToExcel(
  sheetName: string,
  records: Array<Record<string, unknown>>,
  filename = '7sunday-export.xlsx'
) {
  const ws = XLSX.utils.json_to_sheet(records);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 30));
  XLSX.writeFile(wb, filename);
}

export const ORDER_STATUS_LABELS: Record<CustomerOrder['status'], string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  processing: 'Processing',
  ready_for_delivery: 'Ready for Delivery',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

export function downloadOrderInvoicePDF(order: CustomerOrder) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  doc.setFontSize(20);
  doc.setTextColor(8, 43, 89); // Navy #082B59
  doc.text('Seven Sunday Ethiopia — Official Invoice', 44, 54);

  doc.setFontSize(10);
  doc.setTextColor(41, 56, 88);
  doc.text(`Invoice Number: ${order.invoiceNumber}`, 44, 82);
  doc.text(`Order Number: ${order.orderNumber}`, 44, 98);
  doc.text(`Order Date: ${new Date(order.createdAt).toLocaleString()}`, 44, 114);
  doc.text(`Status: ${(ORDER_STATUS_LABELS[order.status] || order.status).toUpperCase()}`, 44, 130);

  doc.setTextColor(21, 36, 58);
  doc.setFontSize(11);
  doc.text('Bill To:', 360, 82);
  doc.setFontSize(10);
  doc.text(order.customerName, 360, 98);
  if (order.customerPhone) doc.text(`Tel: ${order.customerPhone}`, 360, 114);
  if (order.customerEmail) doc.text(order.customerEmail, 360, 128);
  if (order.shippingAddress) doc.text(order.shippingAddress.slice(0, 52), 360, 142);

  let y = 180;
  doc.setFillColor(234, 244, 255);
  doc.rect(44, y - 14, 505, 22, 'F');
  doc.setFontSize(9.5);
  doc.setTextColor(8, 43, 89);
  doc.text('Item', 52, y);
  doc.text('SKU', 250, y);
  doc.text('Qty', 345, y);
  doc.text('Unit Price', 410, y);
  doc.text('Line Total', 485, y);

  y += 22;
  doc.setTextColor(41, 56, 88);
  order.items.forEach((item) => {
    const qtyLabel = item.unit ? `${item.quantity} ${item.unit}` : String(item.quantity);
    doc.text(item.name.slice(0, 32), 52, y);
    doc.text(item.sku.slice(0, 14), 250, y);
    doc.text(qtyLabel.slice(0, 12), 345, y);
    doc.text(`${order.currency} ${item.unitPrice.toFixed(2)}`, 410, y);
    doc.text(`${order.currency} ${(item.quantity * item.unitPrice).toFixed(2)}`, 485, y);
    y += 20;
  });

  y += 16;
  doc.setDrawColor(17, 120, 185);
  doc.line(340, y - 10, 549, y - 10);
  doc.setFontSize(11);
  doc.setTextColor(8, 43, 89);
  doc.text(`Total: ${order.currency} ${order.total.toFixed(2)}`, 415, y + 6);

  doc.save(`Invoice-${order.invoiceNumber}.pdf`);
}

export function downloadFinancialReceiptPDF(tx: FinancialTransaction) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  doc.setFontSize(20);
  doc.setTextColor(8, 43, 89);
  doc.text('Seven Sunday Ethiopia — Transaction Receipt', 44, 54);

  doc.setFontSize(10);
  doc.setTextColor(41, 56, 88);
  doc.text(`Transaction #: ${tx.txNumber}`, 44, 88);
  doc.text(`Date: ${new Date(tx.createdAt).toLocaleString()}`, 44, 106);
  doc.text(`Type: ${tx.type.replace('_', ' ').toUpperCase()}`, 44, 124);
  doc.text(`Method: ${tx.method.replace('_', ' ').toUpperCase()}`, 44, 142);
  doc.text(`Status: ${tx.status.toUpperCase()}`, 44, 160);

  doc.setFillColor(234, 244, 255);
  doc.rect(44, 190, 505, 56, 'F');
  doc.setFontSize(11);
  doc.setTextColor(21, 36, 58);
  doc.text(`Customer: ${tx.customerName}`, 56, 212);
  doc.text(`Amount: ${tx.currency} ${tx.amount.toFixed(2)}`, 56, 232);
  if (tx.orderNumber) doc.text(`Order #: ${tx.orderNumber}`, 320, 212);
  if (tx.invoiceNumber) doc.text(`Invoice #: ${tx.invoiceNumber}`, 320, 232);

  if (tx.notes) {
    doc.setFontSize(9.5);
    doc.setTextColor(41, 56, 88);
    doc.text(`Notes: ${tx.notes.slice(0, 95)}`, 44, 276);
  }

  doc.save(`Receipt-${tx.txNumber}.pdf`);
}

export function downloadFinancialLedgerPDF(
  transactions: FinancialTransaction[],
  title = 'Financial Transaction Ledger'
) {
  exportReportToPDF(
    title,
    `Ledger Entries: ${transactions.length}`,
    ['Transaction #', 'Customer', 'Type', 'Method', 'Amount', 'Status', 'Date'],
    transactions.map((t) => [
      t.txNumber,
      t.customerName,
      t.type.replace('_', ' '),
      t.method.replace('_', ' '),
      `${t.currency} ${t.amount.toFixed(2)}`,
      t.status,
      new Date(t.createdAt).toLocaleDateString(),
    ]),
    '7sunday-financial-ledger.pdf'
  );
}

export function downloadDocumentFile(filename: string, content: string, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportDatabaseBackupJSON(data: Record<string, unknown>, filename = `7sunday-backup-${new Date().toISOString().slice(0, 10)}.json`) {
  const json = JSON.stringify({ exportedAt: new Date().toISOString(), platform: '7Sunday Ethiopia / Seven Sunday Connect', ...data }, null, 2);
  downloadDocumentFile(filename, json, 'application/json;charset=utf-8');
}

export function downloadMeetingICS(meeting: Meeting, joinUrl: string) {
  const formatICSDate = (iso: string) =>
    new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//7Sunday Meet//Seven Sunday Connect//EN',
    'BEGIN:VEVENT',
    `UID:${meeting.id}@sevensundayethiopia.com`,
    `DTSTAMP:${formatICSDate(new Date().toISOString())}`,
    `DTSTART:${formatICSDate(meeting.startTime)}`,
    `DTEND:${formatICSDate(meeting.endTime)}`,
    `SUMMARY:${meeting.title.replace(/\n/g, ' ')}`,
    `DESCRIPTION:${(meeting.agenda || meeting.description || '').replace(/\n/g, '\\n')}\\nJoin URL: ${joinUrl}`,
    `LOCATION:${joinUrl}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const blob = new Blob([lines], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `7SundayMeet-${meeting.meetingCode}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}
