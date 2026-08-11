import { ForbiddenException } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { StatisticsController } from './statistics.controller';
import { StatisticsService } from './statistics.service';

describe('StatisticsController', () => {
  const makeController = () => {
    const getUserStatistics = jest.fn();
    const exportReport = jest.fn();
    const statisticsService = {
      getUserStatistics,
    } as unknown as jest.Mocked<StatisticsService>;
    const reportsService = {
      exportReport,
    } as unknown as jest.Mocked<ReportsService>;

    return {
      getUserStatistics,
      exportReport,
      statisticsService,
      controller: new StatisticsController(statisticsService, reportsService),
    };
  };

  it('blocks BASIC users from the premium statistics API', () => {
    const { controller, getUserStatistics } = makeController();

    expect(() =>
      controller.getStatistics(
        { user: { userId: 7, role: 'BASIC' } } as Parameters<
          StatisticsController['getStatistics']
        >[0],
        'month',
      ),
    ).toThrow(ForbiddenException);
    expect(getUserStatistics).not.toHaveBeenCalled();
  });

  it('allows PREMIUM users to load statistics', () => {
    const { controller, getUserStatistics } = makeController();

    void controller.getStatistics(
      { user: { userId: 7, role: 'PREMIUM' } } as Parameters<
        StatisticsController['getStatistics']
      >[0],
      'month',
    );

    expect(getUserStatistics).toHaveBeenCalledWith(7, 'month');
  });

  it('forwards quarter report dates to the report service', () => {
    const { controller, exportReport } = makeController();

    void controller.exportReport(
      { user: { userId: 7, role: 'PREMIUM' } } as Parameters<
        StatisticsController['exportReport']
      >[0],
      'quarter',
      'pdf',
      '2026-04-01',
      '2026-06-30',
    );

    expect(exportReport).toHaveBeenCalledWith(7, 'PREMIUM', 'quarter', 'pdf', {
      dateFrom: '2026-04-01',
      dateTo: '2026-06-30',
    });
  });
});
