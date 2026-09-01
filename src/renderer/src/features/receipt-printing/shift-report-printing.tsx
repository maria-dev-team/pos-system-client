import { useMutation } from '@tanstack/react-query';
import { LoaderCircle, Printer } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  type FiscalShiftReportResponse,
  getXReport,
  getZReport,
} from '@renderer/common/api';
import { Button } from '@renderer/common/components/ui/button';
import { getHttpErrorMessage } from '@renderer/common/helpers/http-error.helper';

import { readReceiptPrinterSettings } from './printer-settings';
import { buildPrintableShiftReport } from './shift-report-data';

function ShiftReportPrintButton({
  className,
  label,
  loadReport,
  timeZone,
}: {
  className?: string;
  label: string;
  loadReport: () => Promise<FiscalShiftReportResponse>;
  timeZone: string;
}) {
  const [isPrinting, setIsPrinting] = useState(false);
  const report = useMutation({ mutationFn: loadReport });

  const print = async () => {
    const printShiftReport = window.receiptPrinter?.printShiftReport;
    if (!printShiftReport) {
      toast.error('Печать отчётов недоступна в этом окружении.');
      return;
    }

    setIsPrinting(true);
    try {
      const fiscalReport = await report.mutateAsync();
      const result = await printShiftReport({
        ...readReceiptPrinterSettings(),
        report: buildPrintableShiftReport(fiscalReport, timeZone),
      });
      if (result.ok) {
        toast.success(`${fiscalReport.report_type}-отчёт отправлен на принтер`);
      } else {
        toast.error(result.message);
      }
    } catch (error) {
      toast.error(
        getHttpErrorMessage(error, 'Не удалось подготовить отчёт к печати.'),
      );
    } finally {
      setIsPrinting(false);
    }
  };

  return (
    <Button
      className={className}
      disabled={isPrinting}
      onClick={() => void print()}
      type="button"
      variant="ghost"
    >
      {isPrinting ? (
        <LoaderCircle aria-hidden="true" className="animate-spin" />
      ) : (
        <Printer aria-hidden="true" />
      )}
      {label}
    </Button>
  );
}

export function XReportPrintButton({
  className,
  registerShiftId,
  timeZone,
}: {
  className?: string;
  registerShiftId: string;
  timeZone: string;
}) {
  return (
    <ShiftReportPrintButton
      className={className}
      label="Печать X-отчёта"
      loadReport={() => getXReport(registerShiftId)}
      timeZone={timeZone}
    />
  );
}

export function ZReportPrintButton({
  report,
  timeZone,
}: {
  report: FiscalShiftReportResponse;
  timeZone: string;
}) {
  return (
    <ShiftReportPrintButton
      label="Печать Z-отчёта"
      loadReport={() => Promise.resolve(report)}
      timeZone={timeZone}
    />
  );
}

export function LastZReportPrintButton({
  className,
  registerShiftId,
  timeZone,
}: {
  className?: string;
  registerShiftId: string;
  timeZone: string;
}) {
  return (
    <ShiftReportPrintButton
      className={className}
      label="Печать последнего Z-отчёта"
      loadReport={() => getZReport(registerShiftId)}
      timeZone={timeZone}
    />
  );
}
