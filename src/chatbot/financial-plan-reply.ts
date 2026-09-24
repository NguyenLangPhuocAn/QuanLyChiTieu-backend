import type { FinancialPlansService } from '../financial-plans/financial-plans.service';

type Overview = Awaited<ReturnType<FinancialPlansService['getOverview']>>;
const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();

/** Guided requests use computed numbers; ordinary questions still go to the model. */
export function buildFinancialPlanReply(
  overview: Overview,
  question: string,
): string | null {
  const normalized = normalize(question);
  const match =
    /^(goi y 3 ke hoach tai chinh|lap ke hoach giam chi|lap ke hoach tiet kiem|lap quy du phong)(?: trong)?(?: ([1-4]) thang)?[?.!]*$/.exec(
      normalized,
    );
  if (!match) return null;
  const months = Number(match[2] ?? 3);
  const all = match[1].startsWith('goi y');
  const lines = [
    `Kế hoạch ${months} tháng, tính từ tháng hiện tại. Đây là đề xuất để bạn xem và điều chỉnh; chưa tạo mục tiêu hay chuyển tiền.`,
  ];
  for (const cashflow of overview.cashflow_plans ?? []) {
    const money = (amount: number) =>
      new Intl.NumberFormat('vi-VN', {
        maximumFractionDigits: cashflow.currency === 'VND' ? 0 : 2,
      }).format(amount) + ` ${cashflow.currency}`;
    lines.push(`\n${cashflow.currency}`);
    const forecast = cashflow.forecast.slice(0, months);
    const net =
      forecast.reduce((sum, row) => sum + row.projected_net, 0) /
      Math.max(1, forecast.length);
    const goals = (overview.savings_plans ?? []).filter(
      (goal) => goal.currency === cashflow.currency,
    );
    const monthlyCapacity = forecast.map((row) => {
      const scheduled = goals.reduce(
        (sum, goal) =>
          sum +
          (goal.roadmap?.schedule ?? [])
            .filter((payment) => payment.due_date.slice(0, 7) === row.month)
            .reduce((total, payment) => total + payment.amount, 0),
        0,
      );
      return { ...row, scheduled, available: row.projected_net - scheduled };
    });
    const unresolvedGoals = goals.some(
      (goal) =>
        goal.remaining_amount > 0 && goal.roadmap?.status !== 'SCHEDULED',
    );
    const insufficient = cashflow.summary.status === 'INSUFFICIENT_DATA';
    if (insufficient)
      lines.push(
        'Dữ liệu còn ít. Chưa dùng dự báo để khẳng định bạn có tiền dư; hãy bổ sung thu nhập, chi cố định và ngày cần tiền.',
      );
    else
      lines.push(
        `Chênh lệch thu – chi dự kiến: ${money(net)}/tháng. Chưa trừ trả nợ và góp tiết kiệm.`,
      );

    if (all || match[1] === 'lap ke hoach giam chi') {
      lines.push('\n1. Giảm chi có mục tiêu');
      const actions = (cashflow.spending_actions ?? []).filter(
        (action) => action.monthly_reduction > 0,
      );
      if (!actions.length)
        lines.push(
          'Chưa đủ dữ liệu phân loại để đặt mức giảm. Tuần đầu ghi đủ giao dịch, phân biệt khoản thiết yếu với khoản có thể hoãn.',
        );
      for (const action of actions)
        lines.push(
          `${action.category}: trung bình ${money(action.monthly_baseline)}/tháng → thử giới hạn ${money(action.monthly_target)}/tháng, giảm ${money(action.monthly_reduction)}. ${action.steps.join(' ')}`,
        );
      const reduction = actions.reduce(
        (sum, action) => sum + action.monthly_reduction,
        0,
      );
      if (reduction)
        lines.push(
          `Nếu duy trì ${months} tháng, giảm khoảng ${money(reduction * months)} so với mức trung bình cũ; không cộng khoản này vào dự báo như tiền đã có.`,
        );
      lines.push(
        'Mỗi cuối tuần: mở Ngân sách, so thực chi với mức giới hạn và điều chỉnh khoản có thể hoãn.',
      );
    }
    if (all || match[1] === 'lap ke hoach tiet kiem') {
      lines.push('\n2. Góp theo mục tiêu');
      if (!goals.length)
        lines.push(
          'Chọn một mục tiêu, nhập tổng số tiền, số tiền đã có và ngày cần dùng trong mục Tiết kiệm. Chưa có các thông tin này nên chưa đặt số tiền góp.',
        );
      for (const goal of goals) {
        const roadmap = goal.roadmap;
        lines.push(`${goal.name}: còn thiếu ${money(goal.remaining_amount)}.`);
        if (roadmap?.status === 'SCHEDULED') {
          lines.push(
            `Kỳ tới góp thêm ${money(roadmap.next_contribution ?? 0)} trước ${roadmap.next_due_date}; có thể chia khoảng ${money(roadmap.weekly_amount ?? 0)}/tuần thay cho cách góp tháng.`,
          );
          lines.push(
            `Lịch ${months} kỳ đầu: ${roadmap.schedule
              .slice(0, months)
              .map((row) => `${row.due_date}: ${money(row.amount)}`)
              .join('; ')}.`,
          );
        } else
          lines.push(
            'Cần đặt hoặc cập nhật ngày hoàn thành trước khi chia lịch góp.',
          );
      }
      if (!insufficient) {
        for (const row of monthlyCapacity) {
          lines.push(
            `${row.month}: thu – chi dự kiến ${money(row.projected_net)}, lịch góp ${money(row.scheduled)}; ${row.available < 0 ? `thiếu ${money(-row.available)}` : `còn ${money(row.available)}`} trước trả nợ.`,
          );
        }
        if (monthlyCapacity.some((row) => row.available < 0))
          lines.push(
            'Có tháng thiếu tiền theo dự báo. Hãy ưu tiên một mục tiêu hoặc lùi hạn; không dùng mức dư trung bình để kết luận mọi tháng đều đủ.',
          );
      }
      lines.push(
        'Góp vào ngày sau khi nhận thu nhập, kiểm tra lại cuối tháng. Khoản đã góp được tính trong số dư, không trừ thêm lần nữa.',
      );
    }
    if (all || match[1] === 'lap quy du phong') {
      lines.push('\n3. Tạo một khoản dự phòng');
      const trialAmount =
        insufficient || unresolvedGoals || !monthlyCapacity.length
          ? 0
          : Math.floor(
              Math.max(
                0,
                Math.min(...monthlyCapacity.map((row) => row.available)),
              ) *
                0.5 *
                100,
            ) / 100;
      if (trialAmount > 0)
        lines.push(
          `Kịch bản thử: dành ${money(trialAmount)}/tháng trong ${forecast.length} tháng có dự báo, tổng ${money(trialAmount * forecast.length)}. Mức này bằng một nửa phần dư thấp nhất trong các tháng sau khi trừ lịch góp từng tháng, chưa trừ nghĩa vụ trả nợ; cần kiểm tra khả năng chi trả trước khi áp dụng.`,
        );
      else
        lines.push(
          unresolvedGoals
            ? 'Có mục tiêu chưa có hạn hoặc đã quá hạn. Cập nhật lịch góp trước khi dành thêm tiền cho quỹ dự phòng.'
            : 'Chưa có phần dư dự báo ổn định ở mọi tháng để đề xuất mức góp thêm. Ưu tiên cân đối thu chi, trả nợ đến hạn và mục tiêu đang có trước.',
        );
      lines.push(
        'Chốt mức quỹ từ chi phí thiết yếu thực tế, giữ ở ví riêng và chỉ dùng cho việc phát sinh cần thiết. Nếu tạo mục tiêu dự phòng, không đồng thời dành khoản này cho mục tiêu khác.',
      );
    }
  }
  if (!(overview.cashflow_plans ?? []).length)
    lines.push(
      'Chưa có dữ liệu thu chi. Hãy ghi thu nhập và chi cố định, thêm mục tiêu kèm ngày hạn; sau đó lập lại kế hoạch.',
    );
  lines.push(
    '\nBạn muốn ưu tiên phương án nào? Cho biết khoản trả nợ mỗi tháng và số tiền muốn giữ lại để điều chỉnh kế hoạch.',
  );
  return lines.join('\n');
}
