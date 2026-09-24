export type CategorySpending = {
  category_id: number;
  category: string;
  amount: number;
};

const normalized = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();

const actionFor = (category: string) => {
  const name = normalized(category);
  if (
    /y te|suc khoe|thuoc|hoc phi|giao duc|tien nha|thue nha|bao hiem|tra no/.test(
      name,
    )
  ) {
    return {
      rate: 0,
      steps: [
        'Giữ khoản thiết yếu này trong ngân sách; kiểm tra hóa đơn và lịch thanh toán để tránh phí trễ hạn.',
      ],
    };
  }
  if (/\b(an|uong|cafe|ca phe|thuc pham)\b/.test(name)) {
    return {
      rate: 0.1,
      steps: [
        'Lên thực đơn và danh sách mua trước khi đi chợ.',
        'Thử thay 1–2 bữa đặt đồ ăn mỗi tuần bằng tự nấu; giữ đủ nhu cầu dinh dưỡng.',
      ],
    };
  }
  if (/mua sam|giai tri|du lich|so thich/.test(name)) {
    return {
      rate: 0.2,
      steps: [
        'Chờ 48 giờ trước khi mua món không thiết yếu.',
        'Dừng một dịch vụ ít dùng và đặt giới hạn cho mỗi lần mua hoặc đi chơi.',
      ],
    };
  }
  if (/di chuyen|giao thong|xang|xe/.test(name)) {
    return {
      rate: 0.1,
      steps: [
        'Gộp việc cần làm trong một chuyến; so sánh chi phí phương tiện phù hợp.',
        'Giảm chuyến xe công nghệ không cần thiết, vẫn ưu tiên an toàn.',
      ],
    };
  }
  if (/dien|nuoc|internet|dien thoai/.test(name)) {
    return {
      rate: 0.05,
      steps: [
        'Kiểm tra gói cước và dịch vụ cộng thêm không dùng.',
        'Theo dõi mức sử dụng hằng tuần, giảm lãng phí thay vì cắt nhu cầu thiết yếu.',
      ],
    };
  }
  return {
    rate: 0,
    steps: [
      'Rà soát giao dịch trong danh mục, tách khoản thiết yếu và khoản có thể hoãn trước khi đặt mức giảm.',
    ],
  };
};

export function buildSpendingActions(
  categories: CategorySpending[],
  historyMonths: number,
) {
  return categories
    .filter((row) => Number.isFinite(row.amount) && row.amount > 0)
    .map((row) => {
      const { rate, steps } = actionFor(row.category);
      const baseline = Math.round((row.amount / historyMonths) * 100) / 100;
      const reduction = Math.floor(baseline * rate * 100) / 100;
      return {
        category_id: row.category_id,
        category: row.category,
        monthly_baseline: baseline,
        monthly_target: Math.round((baseline - reduction) * 100) / 100,
        monthly_reduction: reduction,
        reduction_percent: rate * 100,
        steps,
      };
    })
    .sort(
      (a, b) =>
        b.monthly_reduction - a.monthly_reduction ||
        b.monthly_baseline - a.monthly_baseline,
    )
    .slice(0, 3);
}
