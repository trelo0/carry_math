import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Публичный договор (оферта)",
  description:
    "Публичный договор (оферта) на оказание услуг по дистанционному обучению на образовательной платформе. ИП Колодинская Кристина Денисовна, УНП 693401354.",
};

type OfferListItem = { text: string };

type OfferSection = {
  id: string;
  number: string;
  title: string;
  intro?: string;
  paragraphs?: string[];
  definitions?: { term: string; text: string }[];
  list?: OfferListItem[];
  highlight?: boolean;
};

const SECTIONS: OfferSection[] = [
  {
    id: "terms",
    number: "01",
    title: "Термины и определения",
    definitions: [
      {
        term: "1.1. Личный кабинет",
        text: "закрытая персональная часть Образовательной платформы Исполнителя, доступ к которой предоставляется Ученику после оплаты.",
      },
      {
        term: "1.2. Куратор",
        text: "привлеченный Исполнителем специалист, осуществляющий проверку домашних заданий, консультирование Ученика и контроль успеваемости.",
      },
      {
        term: "1.3. Система жизней",
        text: "элемент геймификации обучения, предусматривающий установление лимита невыполненных в срок обязательных домашних заданий.",
      },
      {
        term: "1.4. Тарифный план (Тариф)",
        text: "утвержденный Исполнителем объем услуг, опций (наличие куратора, личного кабинета, дополнительных материалов) и стоимость, опубликованные на Сайте.",
      },
    ],
  },
  {
    id: "subject",
    number: "02",
    title: "Предмет договора и порядок акцепта",
    paragraphs: [
      "2.1. Исполнитель обязуется оказать Заказчику (или указанному им несовершеннолетнему Ученику) услуги по обучению математике (подготовка к ЦЭ/ЦТ) в соответствии с выбранным Тарифом, а Заказчик обязуется их оплатить.",
      "2.2. Акцептом (заключением) Договора признается факт 100% предоплаты Тарифа Заказчиком на сайте.",
    ],
  },
  {
    id: "lives",
    number: "03",
    title: "Условия геймификации и «Системы жизней»",
    highlight: true,
    intro:
      "Выбирая Тариф, предусматривающий «Систему жизней», Заказчик и Ученик соглашаются со следующими правилами:",
    list: [
      {
        text: "Ученику на определенный период (полный месяц) выделяется фиксированное количество «жизней» — 3.",
      },
      {
        text: "За каждое невыполненное или сданное позже установленного срока обязательное домашнее задание с Ученика списывается 1 (одна) жизнь.",
      },
    ],
    paragraphs: [
      "3.2. В случае списания всех доступных «жизней» за систематическое невыполнение требований преподавателя и куратора, доступ Ученика к онлайн-занятиям в реальном времени и проверке домашних заданий куратором блокируется (Ученик отчисляется с курса).",
      "3.3. Блокировка доступа к курсу за потерю всех «жизней» признается Сторонами отказом Заказчика от дальнейшего получения услуг. В этом случае Исполнитель производит расчет и возврат остатка денежных средств в соответствии с Разделом 5 настоящего Договора — пропорционально неиспользованному времени обучения и за вычетом всех фактически понесенных Исполнителем расходов на организацию обучения Ученика (включая оплату платформы, услуг куратора и банковские комиссии).",
    ],
  },
  {
    id: "account",
    number: "04",
    title: "Правила использования Личного кабинета и интеллектуальная собственность",
    paragraphs: [
      "4.1. Доступ к Личному кабинету предоставляется строго индивидуально. Заказчику и Ученику запрещено передавать логин и пароль третьим лицам, организовывать совместные покупки доступа или скачивать видеоуроки с целью перепродажи.",
      "4.2. Все материалы (видео, тесты, конспекты) являются интеллектуальной собственностью Исполнителя. В случае выявления факта слива или передачи материалов, Исполнитель имеет право безвозвратно заблокировать Личный кабинет без возврата денег и потребовать штраф в соответствии с законодательством РБ.",
    ],
  },
  {
    id: "refund",
    number: "05",
    title: "Порядок возврата средств при досрочном расторжении",
    paragraphs: [
      "5.1. Заказчик имеет право отказаться от Договора в любой момент.",
      "5.2. При досрочном расторжении расчет суммы к возврату производится пропорционально количеству дней, оставшихся до конца оплаченного периода, за вычетом фактически понесенных расходов Исполнителя:",
    ],
    list: [
      { text: "Комиссии платежных систем за эквайринг (банковский сбор);" },
      { text: "Стоимость фактически открытых Ученику на момент отказа учебных модулей и материалов;" },
      { text: "Фиксированная стоимость бронирования места в группе и услуг куратора." },
    ],
  },
];

export default function PublicOfferPage() {
  return (
    <main className="offer-page">
      <div className="container offer-container">
        <header className="offer-header">
          <span className="section-kicker">Документ</span>
          <h1 className="offer-title">
            Публичный договор <span className="offer-title-accent">(оферта)</span>
          </h1>
          <p className="offer-subtitle">
            на оказание услуг по дистанционному обучению
            на образовательной платформе
          </p>

          <div className="offer-meta">
            <span className="offer-meta-chip">УНП 693401354</span>
            <span className="offer-meta-chip">РБ · Гражданский кодекс, ст. 407</span>
          </div>
        </header>

        <section className="offer-lead">
          <p>
            Индивидуальный предприниматель{" "}
            <strong>Колодинская Кристина Денисовна</strong>, зарегистрированный
            Столбцовским районным исполнительным комитетом за УНП{" "}
            <strong>693401354</strong>, именуемый в дальнейшем «Исполнитель»,
            публикует настоящий Публичный договор (далее — «Договор»), являющийся
            публичной офертой в соответствии со статьей 407 Гражданского кодекса
            Республики Беларусь, в адрес любого физического лица (далее —
            «Заказчик»).
          </p>
        </section>

        <div className="offer-body">
          {SECTIONS.map((section) => (
            <section
              key={section.id}
              id={section.id}
              className={
                "offer-section" + (section.highlight ? " offer-section--accent" : "")
              }
            >
              <div className="offer-section-head">
                <span className="offer-section-number">{section.number}</span>
                <h2 className="offer-section-title">{section.title}</h2>
              </div>

              {section.intro && <p className="offer-text">{section.intro}</p>}

              {section.definitions && (
                <dl className="offer-definitions">
                  {section.definitions.map((d) => (
                    <div key={d.term} className="offer-definition">
                      <dt>{d.term}</dt>
                      <dd>— {d.text}</dd>
                    </div>
                  ))}
                </dl>
              )}

              {section.paragraphs?.map((p) => (
                <p key={p.slice(0, 24)} className="offer-text">
                  {p}
                </p>
              ))}

              {section.list && (
                <ul className="offer-list">
                  {section.list.map((item, i) => (
                    <li key={i}>{item.text}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}

          <section id="requisites" className="offer-section">
            <div className="offer-section-head">
              <span className="offer-section-number">06</span>
              <h2 className="offer-section-title">Реквизиты исполнителя</h2>
            </div>

            <div className="offer-requisites">
              <div className="offer-requisites-row">
                <span className="offer-requisites-label">Исполнитель</span>
                <span className="offer-requisites-value">
                  Индивидуальный предприниматель Колодинская Кристина Денисовна
                </span>
              </div>
              <div className="offer-requisites-row">
                <span className="offer-requisites-label">УНП</span>
                <span className="offer-requisites-value">693401354</span>
              </div>
              <div className="offer-requisites-row">
                <span className="offer-requisites-label">Регистрация</span>
                <span className="offer-requisites-value">
                  Свидетельство выдано Столбцовским райисполкомом 24.08.2026 г.
                </span>
              </div>
              <div className="offer-requisites-row">
                <span className="offer-requisites-label">Адрес</span>
                <span className="offer-requisites-value">
                  г. Столбцы, ул. Лермонтова, 6
                </span>
              </div>
              <div className="offer-requisites-row">
                <span className="offer-requisites-label">E-mail</span>
                <span className="offer-requisites-value">
                  <a href="mailto:district.school.210@gmail.com">
                    district.school.210@gmail.com
                  </a>
                </span>
              </div>
              <div className="offer-requisites-row">
                <span className="offer-requisites-label">Телефон</span>
                <span className="offer-requisites-value">
                  <a href="tel:+375336358488">+375 33 635-84-88</a>
                </span>
              </div>
            </div>
          </section>
        </div>

        <div className="offer-footer">
          <Link href="/" className="offer-back-link">
            <span aria-hidden="true">&larr;</span> Вернуться на главную
          </Link>
        </div>
      </div>
    </main>
  );
}
