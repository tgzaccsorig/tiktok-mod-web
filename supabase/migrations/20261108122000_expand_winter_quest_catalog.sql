insert into public.winter_quests(slug,title,description,action_key,cadence,goal,reward_coins,starts_on,active) values
('daily-icebreaker','Разморозка ленты','Поставь два лайка новым авторам сегодня.','like','daily',2,12,'2026-12-20',true),
('daily-snowstorm','Снежная буря','Поставь 8 лайков за день.','like','daily',8,35,'2026-12-20',true),
('daily-community','Тёплая компания','Подпишись на двух авторов сегодня.','follow','daily',2,25,'2026-12-20',true),
('weekly-heartline','Линия поддержки','Поставь 20 лайков за неделю.','like','weekly',20,80,'2026-12-20',true),
('weekly-discovery','Исследователь ленты','Подпишись на 7 авторов за неделю.','follow','weekly',7,100,'2026-12-20',true),
('weekly-superfan','Суперфан','Поставь 45 лайков за неделю.','like','weekly',45,160,'2026-12-20',true),
('event-liker-100','Сотня снежных сердец','Поставь 100 лайков за всё событие.','like','special',100,350,'2026-12-20',true),
('event-follow-15','Большой круг друзей','Подпишись на 15 авторов за событие.','follow','special',15,260,'2026-12-20',true),
('event-like-25','Сердце праздника','Поставь 25 лайков за всё событие.','like','special',25,130,'2026-12-20',true),
('event-follow-3','Три новых автора','Найди и поддержи трёх авторов подпиской.','follow','special',3,60,'2026-12-20',true),
('daily-like-12','Полярное сияние','Поставь 12 лайков за день.','like','daily',12,55,'2026-12-20',true),
('weekly-follow-2','Новые горизонты','Подпишись на двух авторов за неделю.','follow','weekly',2,30,'2026-12-20',true)
on conflict(slug) do nothing;