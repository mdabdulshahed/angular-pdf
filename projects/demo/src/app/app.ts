import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PdfExportService } from 'ngx-pdf-export';

interface Order {
  id: string;
  customer: string;
  email: string;
  amount: number;
  status: 'Paid' | 'Pending' | 'Refunded';
}

@Component({
  selector: 'app-root',
  imports: [CommonModule],
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App implements OnInit {
  protected readonly title = signal('ngx-pdf-export demo');
  protected readonly busy = signal(false);
  protected readonly lastMessage = signal('');

  protected readonly orders: Order[] = Array.from({ length: 42 }, (_, i) => ({
    id: `INV-${1000 + i}`,
    customer: ['Aarav Sharma', 'Priya Nair', 'John Smith', 'Fatima Khan', 'Wei Chen'][i % 5],
    email: ['aarav@example.com', 'priya@example.com', 'john@example.com', 'fatima@example.com', 'wei@example.com'][i % 5],
    amount: Math.round((500 + i * 137.5) * 100) / 100,
    status: (['Paid', 'Pending', 'Refunded'] as const)[i % 3],
  }));

  protected readonly chartBars = [62, 84, 47, 95, 70, 55, 88];

  constructor(private readonly pdf: PdfExportService) {}

  async ngOnInit(): Promise<void> {
    try {
      await this.pdf.registerFont({ family: 'Noto Sans', src: 'fonts/NotoSans-Regular.ttf', weight: 400 });
      await this.pdf.registerFont({ family: 'Noto Sans', src: 'fonts/NotoSans-Bold.ttf', weight: 700 });
    } catch (err) {
      console.error('Failed to register demo font', err);
    }
  }

  totalRevenue(): string {
    return this.formatInr(this.totalRevenueValue());
  }

  averageOrderValue(): string {
    return this.formatInr(this.totalRevenueValue() / this.orders.length);
  }

  private totalRevenueValue(): number {
    return this.orders.reduce((sum, o) => sum + o.amount, 0);
  }

  formatInr(n: number): string {
    return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  }

  async exportPortrait(): Promise<void> {
    await this.run(() =>
      this.pdf.download('#dashboard', 'dashboard-a4-portrait.pdf', {
        format: 'A4',
        orientation: 'portrait',
        margin: 12,
      }),
    );
  }

  async exportLandscape(): Promise<void> {
    await this.run(() =>
      this.pdf.download('#dashboard', 'dashboard-a4-landscape.pdf', {
        format: 'A4',
        orientation: 'landscape',
        margin: 12,
      }),
    );
  }

  async exportWithHeaderFooter(): Promise<void> {
    await this.run(() =>
      this.pdf.download('#dashboard', 'dashboard-with-header-footer.pdf', {
        format: 'A4',
        orientation: 'portrait',
        margin: 14,
        header: (ctx) => `Sales Dashboard -- generated ${new Date().toLocaleDateString()}`,
        footer: (ctx) => `Page ${ctx.pageNumber} of ${ctx.pageCount}`,
        headerHeight: 20,
        footerHeight: 18,
      }),
    );
  }

  async exportDebug(): Promise<void> {
    await this.run(() =>
      this.pdf.download('#dashboard', 'dashboard-debug.pdf', {
        format: 'A4',
        orientation: 'portrait',
        margin: 12,
        debug: true,
      }),
    );
  }

  private async run(fn: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.lastMessage.set('');
    try {
      await fn();
      this.lastMessage.set('Export complete.');
    } catch (err) {
      console.error(err);
      this.lastMessage.set(`Export failed: ${(err as Error).message}`);
    } finally {
      this.busy.set(false);
    }
  }
}
