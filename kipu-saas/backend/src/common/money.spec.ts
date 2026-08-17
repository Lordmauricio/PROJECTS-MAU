import { money, sumMoney, ZERO_MONEY } from './money';

describe('money', () => {
  it('redondea a 2 decimales con half-up', () => {
    expect(money(1.005).toFixed(2)).toBe('1.01'); // 1.005 -> 1.01 (half-up), no 1.00 (banker's/floor)
    expect(money(1.004).toFixed(2)).toBe('1.00');
    expect(money('19.995').toFixed(2)).toBe('20.00');
  });

  it('nunca usa aritmética de number de JS: acepta string/number y devuelve Decimal', () => {
    const a = money(10);
    const b = money('5.5');
    expect(a.add(b).toFixed(2)).toBe('15.50');
  });

  it('suma una lista de montos redondeando cada uno antes de sumar', () => {
    const total = sumMoney([10.005, 10.005, 10.005]); // cada uno -> 10.01 tras redondeo
    expect(total.toFixed(2)).toBe('30.03');
  });

  it('ZERO_MONEY es neutro para la suma', () => {
    expect(ZERO_MONEY.add(money(42)).toFixed(2)).toBe('42.00');
  });

  it('sumMoney([]) da 0', () => {
    expect(sumMoney([]).toFixed(2)).toBe('0.00');
  });
});
