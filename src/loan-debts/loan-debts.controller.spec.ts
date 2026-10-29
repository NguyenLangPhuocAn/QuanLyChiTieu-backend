import { LoanDebtsController } from './loan-debts.controller';
import { LoanDebtsService } from './loan-debts.service';
import { LoanDebtType } from './dto/create-loan-debt.dto';
describe('loan widget endpoint', () => {
  it('requires a key and delegates only the authenticated owner', async () => {
    const create = jest.fn().mockResolvedValue({ id: 1 });
    const controller = new LoanDebtsController({
      create,
    } as unknown as LoanDebtsService);
    const req = { user: { userId: 8 } } as never;
    const dto = {
      person_name: 'QA',
      type: LoanDebtType.BORROWED,
      principal_amount: '100',
      wallet_id: 10,
    };
    expect(() => controller.createQuickEntry(req, dto)).toThrow(
      'chống ghi trùng',
    );
    expect(create).not.toHaveBeenCalled();
    const payload = { ...dto, client_request_id: 'widget_loan_request_1234' };
    await controller.createQuickEntry(req, payload);
    expect(create).toHaveBeenCalledWith(8, payload);
  });
});
