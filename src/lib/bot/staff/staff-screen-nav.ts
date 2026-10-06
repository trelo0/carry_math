/** Куда ведут «Назад» / «Главное меню» в inline-экранах staff. */
export type StaffScreenNav = {
  categoriesBack?: string;
  mainMenuBack?: string;
  listBack?: string;
};

export const TEACHER_DEFAULT_NAV: StaffScreenNav = {
  categoriesBack: 't:hw',
  mainMenuBack: 't:menu',
  listBack: 't:msg:l',
};

export const CURATOR_DEFAULT_NAV: StaffScreenNav = {
  categoriesBack: 'c:hw',
  mainMenuBack: 'c:menu',
  listBack: 'c:msg:l',
};

export const COMBINED_TEACHER_HW_NAV: StaffScreenNav = {
  categoriesBack: 's:hw:t',
  mainMenuBack: 's:menu',
};

export const COMBINED_TEACHER_MSG_NAV: StaffScreenNav = {
  mainMenuBack: 's:menu',
  listBack: 's:msg',
};

export const COMBINED_CURATOR_HW_NAV: StaffScreenNav = {
  categoriesBack: 's:hw:c',
  mainMenuBack: 's:menu',
};

export const COMBINED_CURATOR_MSG_NAV: StaffScreenNav = {
  mainMenuBack: 's:menu',
  listBack: 's:msg',
};

export const COMBINED_STUDENTS_NAV: StaffScreenNav = {
  listBack: 's:stu',
  mainMenuBack: 's:menu',
};

export const COMBINED_CURATOR_COURSE_NAV: StaffScreenNav = {
  mainMenuBack: 's:menu',
  categoriesBack: 's:menu',
  listBack: 's:menu',
};
