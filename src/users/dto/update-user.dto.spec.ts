import { validate } from 'class-validator';
import { UpdateUserDto } from './update-user.dto';

it('allows clearing optional profile fields explicitly', async () => {
  const dto = Object.assign(new UpdateUserDto(), {
    full_name: null,
    phone: null,
    address: null,
    birthday: null,
  });
  expect(await validate(dto)).toEqual([]);
});

it('rejects a nonexistent calendar birthday', async () => {
  const dto = Object.assign(new UpdateUserDto(), { birthday: '2026-02-30' });
  expect((await validate(dto)).map((error) => error.property)).toContain(
    'birthday',
  );
});

it('accepts a leap-day birthday in a leap year', async () => {
  const dto = Object.assign(new UpdateUserDto(), { birthday: '2004-02-29' });
  expect(await validate(dto)).toEqual([]);
});
