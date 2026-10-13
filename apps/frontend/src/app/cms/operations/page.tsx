'use client';

import { ToastNotice } from '@/components/ToastNotice';

import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { DateTimeFields } from '@/components/DateTimeFields';
import { parseLocalTime } from '@/lib/date-time';
import useSWR from 'swr';
import {
  App as AntApp,
  Button,
  Card,
  Col,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Row,
  Select,
  Space,
  Statistic,
  Steps,
  Switch,
  Table,
  Tabs,
  Tag,
  TimePicker,
  Typography,
} from 'antd';
import {
  CalendarClock,
  CheckCircle2,
  LockKeyhole,
  MapPin,
  Play,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
} from 'lucide-react';
import { CmsPageHeader } from '@/components/cms/CmsPageHeader';
import { CompetitionEntriesPanel } from '@/components/cms/CompetitionEntriesPanel';
import { api, fetcher } from '@/lib/api';
import {
  CONFLICT_SEVERITY_META,
  CONFLICT_TYPE_LABELS,
  RESULT_ACTION_LABELS,
  RESULT_STATUS_META,
  labelOf,
  statusMeta,
} from '@/lib/vi-labels';

const resultLabels = RESULT_STATUS_META;

function requestMessage(error: any, fallback: string) {
  const value = error?.response?.data?.message;
  return Array.isArray(value) ? value.join('. ') : value || fallback;
}

export default function OperationsPage() {
  const { message, modal } = AntApp.useApp();
  const [eventId, setEventId] = useState<string>();
  const [activeTab, setActiveTab] = useState('resources');
  const [venueOpen, setVenueOpen] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [slotSession, setSlotSession] = useState<any>();
  const [ruleOpen, setRuleOpen] = useState(false);
  const [scheduleResult, setScheduleResult] = useState<any>();
  const [scheduling, setScheduling] = useState(false);
  const [resultMatch, setResultMatch] = useState<any>();
  const [resultStatus, setResultStatus] = useState<string>();
  const [matchSearch, setMatchSearch] = useState('');
  const [venueForm] = Form.useForm();
  const [sessionForm] = Form.useForm();
  const [slotForm] = Form.useForm();
  const [ruleForm] = Form.useForm();

  const { data: eventsResponse } = useSWR<any>('/events?limit=200', fetcher);
  const events = useMemo(() => eventsResponse?.items || [], [eventsResponse?.items]);
  const { data: currentUser } = useSWR<any>('/auth/profile', fetcher);
  const { data: event } = useSWR<any>(eventId ? `/events/${eventId}` : null, fetcher);
  const { data: overview, mutate: mutateOverview } = useSWR<any>(eventId ? `/scheduling/events/${eventId}/overview` : null, fetcher);
  const { data: readiness, error: readinessError, isLoading: readinessLoading, mutate: mutateReadiness } = useSWR<any>(eventId ? `/scheduling/events/${eventId}/readiness` : null, fetcher);
  const { data: venues = [], mutate: mutateVenues } = useSWR<any[]>(eventId ? `/scheduling/venues?eventId=${eventId}` : null, fetcher);
  const { data: sessions = [], mutate: mutateSessions } = useSWR<any[]>(eventId ? `/scheduling/events/${eventId}/sessions` : null, fetcher);
  const { data: rules = [], mutate: mutateRules } = useSWR<any[]>(eventId ? `/scheduling/events/${eventId}/rules` : null, fetcher);
  const { data: conflictReport, mutate: mutateConflicts } = useSWR<any>(eventId ? `/scheduling/events/${eventId}/conflicts` : null, fetcher);
  const { data: matchesResponse, mutate: mutateMatches } = useSWR<any>(eventId ? `/matches?eventId=${eventId}&limit=50` : null, fetcher);
  const matches = matchesResponse?.items || [];
  const sports = event?.sports?.length ? event.sports : event?.sport ? [event.sport] : [];
  const counts = useMemo(() => overview?.counts || {}, [overview?.counts]);
  const isAdmin = currentUser?.role === 'ADMIN';
  const hasRole = (...roles: string[]) => isAdmin || roles.includes(currentUser?.role);
  const canCreateVenue = hasRole('GAMES_ADMIN');
  const canManageSessions = hasRole('GAMES_ADMIN');
  const canManageRules = hasRole('GAMES_ADMIN');
  const canManageEntries = hasRole('GAMES_ADMIN');
  const canSchedule = hasRole('GAMES_ADMIN');

  useEffect(() => {
    if (eventId || !events.length) return;
    const saved = localStorage.getItem('cms_operations_event');
    if (saved && events.some((item: any) => item.id === saved)) setEventId(saved);
    else if (events.length === 1) setEventId(events[0].id);
  }, [eventId, events]);

  const selectEvent = (value: string) => {
    setEventId(value);
    setScheduleResult(undefined);
    setActiveTab('resources');
    localStorage.setItem('cms_operations_event', value);
  };

  const openSessionForm = () => {
    const start = dayjs(overview?.startDate || event?.startDate).hour(8).minute(0).second(0);
    sessionForm.setFieldsValue({
      venueId: venues[0]?.id,
      sportId: sports[0]?.id,
      name: sports[0]?.name ? `Ca sáng · ${sports[0].name}` : 'Ca sáng',
      startTime: start,
      endTime: start.hour(12),
    });
    setSessionOpen(true);
  };

  const loadRule = (sportId: string) => {
    const rule = rules.find((item: any) => item.sportId === sportId);
    ruleForm.setFieldsValue({
      sportId,
      matchDurationMinutes: rule?.matchDurationMinutes ?? 10,
      turnaroundMinutes: rule?.turnaroundMinutes ?? 5,
      minRestMinutes: rule?.minRestMinutes ?? 60,
      earliestStart: parseLocalTime(rule?.earliestStart || '08:00'),
      latestEnd: parseLocalTime(rule?.latestEnd || '22:00'),
      preferredStart: parseLocalTime(rule?.preferredStart),
      preferredEnd: parseLocalTime(rule?.preferredEnd),
      outdoor: rule?.outdoor ?? false,
    });
  };

  const openRuleForm = () => {
    const sport = sports.find((item: any) => !rules.some((rule: any) => rule.sportId === item.id)) || sports[0];
    if (sport) loadRule(sport.id);
    setRuleOpen(true);
  };

  const openSlotGenerator = (session: any) => {
    const rule = rules.find((item: any) => item.sportId === session.sportId);
    const venueFops = (event?.fops || []).filter((fop: any) => !fop.venueId || fop.venueId === session.venueId);
    slotForm.setFieldsValue({
      fopIds: venueFops.map((fop: any) => fop.id),
      durationMinutes: rule?.matchDurationMinutes ?? 10,
      turnaroundMinutes: rule?.turnaroundMinutes ?? 5,
    });
    setSlotSession(session);
  };

  const workflow = useMemo(() => {
    const resourceReady = sports.length > 0 && counts.venues > 0 && counts.sessions > 0 && counts.timeSlots > 0 && counts.scheduleRules >= sports.length;
    const registrationReady = counts.entries > 0;
    const formatReady = counts.matches > 0;
    const scheduleReady = formatReady && counts.unscheduledMatches === 0;
    const published = (counts.results?.PUBLISHED || 0) + (counts.results?.LOCKED || 0);
    const resultReady = formatReady && published === counts.matches;
    return [
      { title: 'Tài nguyên', description: resourceReady ? 'Đủ sân, ca và quy tắc' : 'Địa điểm · Sân/sàn · Ca · Khung giờ', ready: resourceReady, tab: 'resources' },
      { title: 'Đăng ký', description: `${counts.entries || 0} lượt đăng ký · ${counts.teams || 0} đội`, ready: registrationReady, tab: 'entries' },
      { title: 'Thể thức', description: `${counts.matches || 0} trận đã sinh`, ready: formatReady, tab: 'entries' },
      { title: 'Xếp lịch', description: scheduleReady ? 'Đã xếp toàn bộ' : `${counts.unscheduledMatches || 0} trận chưa xếp`, ready: scheduleReady, tab: 'schedule' },
      { title: 'Kết quả', description: `${published}/${counts.matches || 0} đã công bố`, ready: resultReady, tab: 'results' },
    ];
  }, [counts, sports.length]);
  const completedSteps = workflow.filter((step) => step.ready).length;
  const nextStep = workflow.find((step) => !step.ready) || workflow[workflow.length - 1];
  const filteredMatches = matches.filter((match: any) => {
    if (resultStatus && (match.resultStatus || 'DRAFT') !== resultStatus) return false;
    const text = `${match.matchNumber || ''} ${match.category?.name || ''} ${match.athlete1?.fullName || match.team1?.name || ''} ${match.athlete2?.fullName || match.team2?.name || ''}`.toLowerCase();
    return text.includes(matchSearch.trim().toLowerCase());
  });
  const readinessIssues = (readiness?.checks || []).filter((check: any) => check.status !== 'PASS');
  const readinessColumns = [
    {
      title: 'Mức',
      dataIndex: 'status',
      width: 110,
      render: (value: string) => (
        <Tag color={value === 'FAIL' ? 'red' : 'gold'}>{value === 'FAIL' ? 'BẮT BUỘC' : 'CẢNH BÁO'}</Tag>
      ),
    },
    { title: 'Hạng mục kiểm tra', dataIndex: 'title', width: 230 },
    { title: 'Chi tiết', dataIndex: 'detail' },
    {
      title: '',
      width: 120,
      render: (_: any, row: any) => <Button onClick={() => setActiveTab(row.tab)}>Xử lý</Button>,
    },
  ];

  const saveVenue = async () => {
    try {
      const values = await venueForm.validateFields();
      await api.post('/scheduling/venues', { ...values, eventIds: [eventId] });
      message.success('Đã tạo địa điểm');
      setVenueOpen(false);
      venueForm.resetFields();
      await Promise.all([mutateVenues(), mutateOverview(), mutateReadiness()]);
    } catch (error: any) {
      if (error?.errorFields) return;
      message.error(requestMessage(error, 'Không thể tạo địa điểm'));
    }
  };

  const saveSession = async () => {
    try {
      const values = await sessionForm.validateFields();
      await api.post(`/scheduling/events/${eventId}/sessions`, {
        ...values,
        startTime: values.startTime.toISOString(),
        endTime: values.endTime.toISOString(),
      });
      message.success('Đã tạo ca thi đấu');
      setSessionOpen(false);
      sessionForm.resetFields();
      await Promise.all([mutateSessions(), mutateOverview(), mutateReadiness()]);
    } catch (error: any) {
      if (error?.errorFields) return;
      message.error(requestMessage(error, 'Không thể tạo ca thi đấu'));
    }
  };

  const generateSlots = async () => {
    try {
      const values = await slotForm.validateFields();
      const response = await api.post(`/scheduling/sessions/${slotSession.id}/time-slots/generate`, values);
      message.success(`Đã tạo ${response.data.created} khung giờ thi đấu`);
      setSlotSession(undefined);
      slotForm.resetFields();
      await Promise.all([mutateSessions(), mutateOverview(), mutateReadiness()]);
    } catch (error: any) {
      if (error?.errorFields) return;
      message.error(requestMessage(error, 'Không thể tạo khung giờ thi đấu'));
    }
  };

  const saveRule = async () => {
    try {
      const values = await ruleForm.validateFields();
      const toTime = (value: any) => value ? value.format('HH:mm') : undefined;
      await api.patch(`/scheduling/events/${eventId}/rules/${values.sportId}`, {
        ...values,
        sportId: undefined,
        earliestStart: toTime(values.earliestStart),
        latestEnd: toTime(values.latestEnd),
        preferredStart: toTime(values.preferredStart),
        preferredEnd: toTime(values.preferredEnd),
      });
      message.success('Đã lưu quy tắc xếp lịch');
      setRuleOpen(false);
      ruleForm.resetFields();
      await Promise.all([mutateRules(), mutateOverview(), mutateReadiness()]);
    } catch (error: any) {
      if (error?.errorFields) return;
      message.error(requestMessage(error, 'Không thể lưu quy tắc'));
    }
  };

  const autoSchedule = async (dryRun: boolean) => {
    if (!eventId) return;
    setScheduling(true);
    try {
      const response = await api.post(`/scheduling/events/${eventId}/auto-schedule`, { dryRun, onlyUnscheduled: true });
      setScheduleResult(response.data);
      message.success(dryRun ? 'Đã mô phỏng lịch' : `Đã xếp ${response.data.scheduled} trận`);
      if (!dryRun) await Promise.all([mutateMatches(), mutateConflicts(), mutateSessions(), mutateOverview(), mutateReadiness()]);
    } catch (error: any) {
      message.error(requestMessage(error, 'Không thể xếp lịch'));
    } finally {
      setScheduling(false);
    }
  };

  const confirmApplySchedule = () => {
    modal.confirm({
      title: 'Áp dụng lịch đã mô phỏng?',
      content: `Hệ thống sẽ ghi lịch cho ${scheduleResult?.scheduled || 0} trận. Các trận đã khóa thủ công được giữ nguyên.`,
      okText: 'Áp dụng lịch',
      cancelText: 'Xem lại',
      onOk: () => autoSchedule(false),
    });
  };

  const setScheduleLock = async (match: any, locked: boolean, reason?: string) => {
    try {
      await api.patch(`/scheduling/matches/${match.id}/lock`, { locked, reason });
      message.success(locked ? 'Đã khóa lịch trận đấu' : 'Đã mở khóa lịch trận đấu');
      await Promise.all([mutateMatches(), mutateOverview(), mutateReadiness()]);
    } catch (error: any) {
      message.error(requestMessage(error, 'Không thể cập nhật khóa lịch'));
    }
  };

  const requestScheduleLock = (match: any) => {
    if (match.scheduleLocked) {
      void setScheduleLock(match, false);
      return;
    }
    let reason = '';
    modal.confirm({
      title: `Khóa lịch trận #${match.matchNumber || '—'}?`,
      content: <Input.TextArea className="mt-3" rows={3} placeholder="Lý do khóa (ví dụ: lịch truyền hình đã xác nhận)" onChange={(event) => { reason = event.target.value; }} />,
      okText: 'Khóa lịch',
      cancelText: 'Hủy',
      onOk: () => setScheduleLock(match, true, reason.trim()),
    });
  };

  const sessionColumns = [
    { title: 'Ca thi đấu', dataIndex: 'name' },
    { title: 'Địa điểm', render: (_: any, row: any) => row.venue?.name },
    { title: 'Bộ môn', render: (_: any, row: any) => row.sport?.name || 'Dùng chung' },
    { title: 'Thời gian', render: (_: any, row: any) => `${dayjs(row.startTime).format('DD/MM HH:mm')} – ${dayjs(row.endTime).format('HH:mm')}` },
    { title: 'Khung giờ', render: (_: any, row: any) => row._count?.timeSlots || 0 },
    { title: '', render: (_: any, row: any) => <Button disabled={!canManageSessions || !event?.fops?.length} onClick={() => openSlotGenerator(row)}>Tạo khung giờ</Button> },
  ];

  const matchColumns = [
    {
      title: 'Trận',
      render: (_: any, row: any) => (
        <div>
          <Typography.Text strong>#{row.matchNumber || '—'} · {row.category?.name}</Typography.Text>
          <Typography.Text type="secondary" className="block text-xs">
            {row.athlete1?.fullName || row.team1?.name || 'Chờ xác định'} gặp {row.athlete2?.fullName || row.team2?.name || 'Chờ xác định'}
          </Typography.Text>
        </div>
      ),
    },
    { title: 'Lịch', render: (_: any, row: any) => row.startTime ? `${dayjs(row.startTime).format('DD/MM HH:mm')} · ${row.fop || '—'}` : <Tag>Chưa xếp</Tag> },
    { title: 'Kết quả', render: (_: any, row: any) => { const state = resultLabels[row.resultStatus || 'DRAFT']; return <Tag color={state.color}>{state.label}</Tag>; } },
    { title: '', render: (_: any, row: any) => <Button onClick={() => setResultMatch(row)}>{row.resultStatus === 'LOCKED' ? 'Xem lịch sử' : 'Xử lý kết quả'}</Button> },
  ];

  const scheduleColumns = [
    { title: 'Trận', render: (_: any, row: any) => <><Typography.Text strong>#{row.matchNumber || '—'} · {row.category?.name}</Typography.Text><Typography.Text type="secondary" className="block text-xs">{row.athlete1?.fullName || row.team1?.name || 'Chờ xác định'} gặp {row.athlete2?.fullName || row.team2?.name || 'Chờ xác định'}</Typography.Text></> },
    { title: 'Thời gian', render: (_: any, row: any) => row.startTime ? dayjs(row.startTime).format('DD/MM/YYYY HH:mm') : <Tag>Chưa xếp</Tag> },
    { title: 'Sàn/FOP', render: (_: any, row: any) => row.fop || '—' },
    { title: 'Khóa thủ công', render: (_: any, row: any) => row.scheduleLocked ? <Tag color="gold" icon={<LockKeyhole className="h-3 w-3" />}>Đã khóa</Tag> : <Tag>Chưa khóa</Tag> },
    { title: '', render: (_: any, row: any) => <Button disabled={!canManageSessions || !row.startTime} onClick={() => requestScheduleLock(row)}>{row.scheduleLocked ? 'Mở khóa' : 'Khóa lịch'}</Button> },
  ];

  const conflictColumns = [
    { title: 'Loại xung đột', dataIndex: 'type', render: (value: string) => labelOf(CONFLICT_TYPE_LABELS, value, 'Xung đột lịch') },
    { title: 'Mức độ', dataIndex: 'severity', render: (value: string) => { const state = statusMeta(CONFLICT_SEVERITY_META, value); return <Tag color={state.color}>{state.label}</Tag>; } },
    { title: 'Trận liên quan', dataIndex: 'matchIds', render: (value: string[]) => value?.join(', ') || '—' },
    { title: 'Chi tiết', render: (_: any, row: any) => row.participant || (row.requiredMinutes ? `Nghỉ tối thiểu ${row.requiredMinutes} phút` : '—') },
  ];

  return (
    <div className="space-y-6">
      <CmsPageHeader title="Điều hành giải đấu" description="Quản lý địa điểm, sân/sàn, ca thi đấu, khung giờ, xếp lịch và công bố kết quả." />

      <Card className="cms-surface">
        <Row gutter={[20, 16]} align="middle">
          <Col xs={24} lg={14}>
            <Typography.Text strong className="mb-2 block">Kỳ đại hội đang điều hành</Typography.Text>
            <Select showSearch optionFilterProp="label" className="w-full" size="large" placeholder="Chọn kỳ đại hội để điều hành" value={eventId} onChange={selectEvent} options={events.map((item: any) => ({ value: item.id, label: item.name }))} />
          </Col>
          {overview && <Col xs={24} lg={10}>
            <Descriptions size="small" column={1}>
              <Descriptions.Item label="Thời gian">{dayjs(overview.startDate).format('DD/MM/YYYY')} – {dayjs(overview.endDate).format('DD/MM/YYYY')}</Descriptions.Item>
              <Descriptions.Item label="Quy mô">{counts.athletes || 0} VĐV · {counts.categories || 0} hạng mục · {sports.length} bộ môn</Descriptions.Item>
            </Descriptions>
          </Col>}
        </Row>
      </Card>

      {!eventId ? <ToastNotice showIcon message="Chọn một kỳ đại hội để bắt đầu." /> : (
        <Space direction="vertical" size="large" className="w-full">
          {currentUser?.role === 'READ_ONLY' && <ToastNotice showIcon type="info" message="Bạn đang ở chế độ chỉ xem" description="Các nút thay đổi dữ liệu được ẩn hoặc vô hiệu hóa theo vai trò tài khoản." />}

          <Card
            className="cms-surface"
            loading={readinessLoading && !readiness}
            title={<Space><ShieldCheck className="h-5 w-5" /> Cổng kiểm tra sẵn sàng vận hành</Space>}
            extra={(
              <Space>
                {readiness && (
                  <Tag color={readiness.ready ? 'green' : 'red'}>
                    {readiness.ready ? 'ĐỦ ĐIỀU KIỆN KỸ THUẬT' : `${readiness.summary?.fail || 0} LỖI BẮT BUỘC`}
                  </Tag>
                )}
                <Button
                  aria-label="Kiểm tra lại mức sẵn sàng"
                  icon={<RefreshCw className="h-4 w-4" />}
                  loading={readinessLoading}
                  onClick={() => mutateReadiness()}
                >
                  Kiểm tra lại
                </Button>
              </Space>
            )}
          >
            {readinessError ? (
              <ToastNotice
                showIcon
                type="error"
                message="Không thể chạy kiểm tra sẵn sàng"
                description={requestMessage(readinessError, 'Vui lòng kiểm tra kết nối API và thử lại.')}
              />
            ) : (
            <>
            <Row gutter={[20, 16]} align="middle">
              <Col xs={24} md={5} className="text-center">
                <Progress
                  type="dashboard"
                  percent={readiness?.score || 0}
                  status={readiness?.ready ? 'success' : 'exception'}
                  format={(percent) => `${percent}%`}
                />
              </Col>
              <Col xs={24} md={19}>
                <ToastNotice
                  showIcon
                  type={readiness?.ready ? (readiness?.summary?.warn ? 'warning' : 'success') : 'error'}
                  message={readiness?.ready ? 'Không còn lỗi kỹ thuật bắt buộc' : 'Chưa được phép chốt lịch vận hành'}
                  description={readiness?.ready
                    ? `${readiness?.summary?.pass || 0} mục đạt · ${readiness?.summary?.warn || 0} cảnh báo cần xem xét.`
                    : `${readiness?.summary?.fail || 0} lỗi bắt buộc · ${readiness?.summary?.warn || 0} cảnh báo. Xử lý hết lỗi bắt buộc rồi chạy kiểm tra lại.`}
                />
              </Col>
            </Row>
            {readinessIssues.length ? (
              <Table
                className="mt-5"
                rowKey="code"
                size="small"
                pagination={false}
                columns={readinessColumns}
                dataSource={readinessIssues}
                loading={readinessLoading}
                scroll={{ x: 760 }}
              />
            ) : (
              <ToastNotice className="mt-5" showIcon type="success" message="Toàn bộ kiểm tra đều đạt." />
            )}
            </>
            )}
          </Card>

          <Card className="cms-surface" title="Tiến độ chuẩn bị và vận hành" extra={<Progress type="circle" size={44} percent={Math.round((completedSteps / workflow.length) * 100)} format={() => `${completedSteps}/${workflow.length}`} />}>
            <Steps
              responsive
              current={Math.max(0, workflow.findIndex((step) => !step.ready))}
              onChange={(index) => setActiveTab(workflow[index].tab)}
              items={workflow.map((step) => ({ title: step.title, description: step.description, status: step.ready ? 'finish' : 'wait' }))}
            />
            <ToastNotice
              className="mt-5"
              showIcon
              type={completedSteps === workflow.length ? 'success' : 'info'}
              message={completedSteps === workflow.length ? 'Đại hội đã hoàn tất toàn bộ quy trình' : `Việc nên làm tiếp theo: ${nextStep.title}`}
              description={completedSteps === workflow.length ? 'Toàn bộ kết quả đã được công bố hoặc khóa.' : nextStep.description}
              action={completedSteps < workflow.length ? <Button type="primary" onClick={() => setActiveTab(nextStep.tab)}>Thực hiện ngay</Button> : undefined}
            />
          </Card>

          <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
          {
            key: 'resources',
            label: '1. Tài nguyên',
            children: (
              <Space direction="vertical" size="large" className="w-full">
                <Row gutter={[16, 16]}>
                  <Col xs={12} lg={6}><Card><Statistic title="Địa điểm" value={venues.length} prefix={<MapPin className="h-4 w-4" />} /></Card></Col>
                  <Col xs={12} lg={6}><Card><Statistic title="Ca thi đấu" value={sessions.length} prefix={<CalendarClock className="h-4 w-4" />} /></Card></Col>
                  <Col xs={12} lg={6}><Card><Statistic title="Quy tắc môn" value={rules.length} /></Card></Col>
                  <Col xs={12} lg={6}><Card><Statistic title="Xung đột" value={conflictReport?.conflictCount || 0} valueStyle={{ color: conflictReport?.valid ? '#22c55e' : '#ef4444' }} /></Card></Col>
                </Row>
                <Card title="Địa điểm → Sân/sàn → Ca thi đấu → Khung giờ" extra={<Space wrap><Button icon={<MapPin className="h-4 w-4" />} disabled={!canCreateVenue} onClick={() => setVenueOpen(true)}>Thêm địa điểm</Button><Button icon={<CalendarClock className="h-4 w-4" />} disabled={!canManageSessions || !venues.length} onClick={openSessionForm}>Thêm ca</Button><Button disabled={!canManageRules || !sports.length} onClick={openRuleForm}>Quy tắc bộ môn</Button></Space>}>
                  {!event?.fops?.length && <ToastNotice className="mb-4" showIcon type="warning" message="Sự kiện chưa có sân/sàn thi đấu" description="Tạo sân/sàn tại trang Sự kiện trước khi sinh khung giờ." />}
                  <Table rowKey="id" size="small" pagination={false} columns={sessionColumns} dataSource={sessions} scroll={{ x: 800 }} />
                </Card>
              </Space>
            ),
          },
          {
            key: 'entries',
            label: `2. Đăng ký & thể thức (${counts.entries || 0})`,
            children: <CompetitionEntriesPanel eventId={eventId} event={event} readOnly={!canManageEntries} onChanged={async () => { await Promise.all([mutateOverview(), mutateMatches(), mutateConflicts(), mutateReadiness()]); }} />,
          },
          {
            key: 'schedule',
            label: `3. Xếp lịch (${counts.scheduledMatches || 0}/${counts.matches || 0})`,
            children: (
              <Space direction="vertical" size="large" className="w-full">
                <Card title="Bộ xếp lịch" extra={<Space wrap><Button icon={<ScanSearch className="h-4 w-4" />} disabled={!canSchedule || !counts.timeSlots || !counts.matches} loading={scheduling} onClick={() => autoSchedule(true)}>1. Mô phỏng</Button><Button type="primary" icon={<Play className="h-4 w-4" />} disabled={!canSchedule || !scheduleResult?.dryRun || scheduleResult?.unscheduled > 0} loading={scheduling} onClick={confirmApplySchedule}>2. Áp dụng lịch</Button></Space>}>
                  {!counts.timeSlots && <ToastNotice className="mb-4" showIcon type="warning" message="Chưa có khung giờ thi đấu" description="Hoàn thành bước Tài nguyên trước khi xếp lịch." action={<Button onClick={() => setActiveTab('resources')}>Sang bước 1</Button>} />}
                  {scheduleResult ? <Descriptions bordered size="small" column={{ xs: 1, sm: 4 }}><Descriptions.Item label="Chế độ">{scheduleResult.dryRun ? 'Mô phỏng' : 'Đã ghi lịch'}</Descriptions.Item><Descriptions.Item label="Yêu cầu">{scheduleResult.requested}</Descriptions.Item><Descriptions.Item label="Đã xếp">{scheduleResult.scheduled}</Descriptions.Item><Descriptions.Item label="Chưa xếp">{scheduleResult.unscheduled}</Descriptions.Item></Descriptions> : <Typography.Text type="secondary">Bước 1: Mô phỏng. Bước 2: kiểm tra số trận chưa xếp. Bước 3: áp dụng lịch.</Typography.Text>}
                </Card>
                <Card title="Lịch đã xếp và khóa thủ công" extra={<Tag color="gold">{counts.lockedSchedules || 0} trận đã khóa</Tag>}>
                  <Table rowKey="id" size="small" columns={scheduleColumns} dataSource={matches} pagination={{ pageSize: 10, showSizeChanger: true }} scroll={{ x: 900 }} />
                </Card>
                <Card title="Báo cáo xung đột" extra={<Button onClick={() => Promise.all([mutateConflicts(), mutateReadiness()])}>Kiểm tra lại</Button>}>
                  {conflictReport?.valid ? <ToastNotice showIcon type="success" message="Lịch hiện tại không có xung đột cứng." /> : <Table rowKey={(_, index) => String(index)} size="small" pagination={{ pageSize: 20 }} columns={conflictColumns} dataSource={conflictReport?.conflicts || []} scroll={{ x: 800 }} />}
                </Card>
              </Space>
            ),
          },
          {
            key: 'results',
            label: '4. Kết quả & phê duyệt',
            children: <Card title="Danh sách trận và trạng thái kết quả" extra={<Space wrap><Input.Search allowClear placeholder="Tìm trận, VĐV hoặc hạng mục" value={matchSearch} onChange={(event) => setMatchSearch(event.target.value)} className="w-64" /><Select allowClear placeholder="Mọi trạng thái" value={resultStatus} onChange={setResultStatus} className="w-48" options={Object.entries(resultLabels).map(([value, item]) => ({ value, label: item.label }))} /></Space>}><Table rowKey="id" columns={matchColumns} dataSource={filteredMatches} pagination={{ pageSize: 20, showSizeChanger: true }} scroll={{ x: 900 }} /></Card>,
          },
        ]} />
        </Space>
      )}

      <Modal title="Thêm địa điểm" open={venueOpen} onCancel={() => setVenueOpen(false)} onOk={saveVenue} destroyOnHidden>
        <Form form={venueForm} layout="vertical"><Row gutter={12}><Col span={8}><Form.Item name="code" label="Mã" rules={[{ required: true }]}><Input placeholder="NHD" /></Form.Item></Col><Col span={16}><Form.Item name="name" label="Tên địa điểm" rules={[{ required: true }]}><Input /></Form.Item></Col></Row><Form.Item name="location" label="Địa chỉ"><Input /></Form.Item><Row gutter={12}><Col span={10}><Form.Item name="capacity" label="Sức chứa"><InputNumber min={0} className="w-full" /></Form.Item></Col><Col span={14}><Form.Item name="timezone" label="Múi giờ" initialValue="Asia/Ho_Chi_Minh"><Input /></Form.Item></Col></Row><Form.Item name="sportIds" label="Bộ môn có thể tổ chức"><Select mode="multiple" options={sports.map((sport: any) => ({ value: sport.id, label: sport.name }))} /></Form.Item></Form>
      </Modal>

      <Modal title="Thêm ca thi đấu" open={sessionOpen} onCancel={() => setSessionOpen(false)} onOk={saveSession} destroyOnHidden>
        <Form form={sessionForm} layout="vertical"><Form.Item name="name" label="Tên ca" rules={[{ required: true }]}><Input placeholder="Ca sáng · Boxing" /></Form.Item><Form.Item name="venueId" label="Địa điểm" rules={[{ required: true }]}><Select options={venues.map((venue: any) => ({ value: venue.id, label: venue.name }))} /></Form.Item><Form.Item name="sportId" label="Bộ môn"><Select allowClear options={sports.map((sport: any) => ({ value: sport.id, label: sport.name }))} /></Form.Item>
          <Form.Item name="startTime" label="Bắt đầu" rules={[{ required: true, message: 'Vui lòng chọn thời gian bắt đầu' }]}>
            <DateTimeFields label="Bắt đầu ca thi đấu" />
          </Form.Item>
          <Form.Item name="endTime" label="Kết thúc" dependencies={['startTime']} rules={[
            { required: true, message: 'Vui lòng chọn thời gian kết thúc' },
            ({ getFieldValue }) => ({
              validator: (_, value) => !value || !getFieldValue('startTime') || value.isAfter(getFieldValue('startTime'))
                ? Promise.resolve()
                : Promise.reject(new Error('Thời gian kết thúc phải sau thời gian bắt đầu')),
            }),
          ]}>
            <DateTimeFields label="Kết thúc ca thi đấu" />
          </Form.Item></Form>
      </Modal>

      <Modal title={`Tạo khung giờ · ${slotSession?.name || ''}`} open={Boolean(slotSession)} onCancel={() => setSlotSession(undefined)} onOk={generateSlots} destroyOnHidden>
        <Form form={slotForm} layout="vertical" initialValues={{ durationMinutes: 10, turnaroundMinutes: 5 }}><Form.Item name="fopIds" label="Sàn/FOP" rules={[{ required: true, type: 'array', min: 1 }]}><Select mode="multiple" options={(event?.fops || []).map((fop: any) => ({ value: fop.id, label: fop.name }))} /></Form.Item><Row gutter={12}><Col span={12}><Form.Item name="durationMinutes" label="Thời lượng (phút)"><InputNumber min={1} className="w-full" /></Form.Item></Col><Col span={12}><Form.Item name="turnaroundMinutes" label="Chuyển sân (phút)"><InputNumber min={0} className="w-full" /></Form.Item></Col></Row></Form>
      </Modal>

      <Modal title="Quy tắc xếp lịch bộ môn" open={ruleOpen} onCancel={() => setRuleOpen(false)} onOk={saveRule} width={720} destroyOnHidden>
        <Form form={ruleForm} layout="vertical" initialValues={{ matchDurationMinutes: 10, turnaroundMinutes: 5, minRestMinutes: 60, outdoor: false }}><Form.Item name="sportId" label="Bộ môn" rules={[{ required: true }]}><Select onChange={loadRule} options={sports.map((sport: any) => ({ value: sport.id, label: sport.name }))} /></Form.Item><Row gutter={12}><Col span={8}><Form.Item name="matchDurationMinutes" label="Thi đấu (phút)"><InputNumber min={1} className="w-full" /></Form.Item></Col><Col span={8}><Form.Item name="turnaroundMinutes" label="Chuyển sân"><InputNumber min={0} className="w-full" /></Form.Item></Col><Col span={8}><Form.Item name="minRestMinutes" label="Nghỉ tối thiểu"><InputNumber min={0} className="w-full" /></Form.Item></Col></Row><Row gutter={12}><Col span={12}><Form.Item name="earliestStart" label="Bắt đầu sớm nhất" initialValue={parseLocalTime('08:00')}><TimePicker needConfirm={false} size="large" format="HH:mm" className="w-full" /></Form.Item></Col><Col span={12}><Form.Item name="latestEnd" label="Kết thúc muộn nhất" initialValue={parseLocalTime('22:00')}><TimePicker needConfirm={false} size="large" format="HH:mm" className="w-full" /></Form.Item></Col><Col span={12}><Form.Item name="preferredStart" label="Khung giờ vàng từ"><TimePicker needConfirm={false} size="large" format="HH:mm" className="w-full" /></Form.Item></Col><Col span={12}><Form.Item name="preferredEnd" label="Khung giờ vàng đến"><TimePicker needConfirm={false} size="large" format="HH:mm" className="w-full" /></Form.Item></Col></Row><Form.Item name="outdoor" label="Môn ngoài trời" valuePropName="checked"><Switch /></Form.Item></Form>
      </Modal>

      {resultMatch && <ResultWorkflowModal match={resultMatch} role={currentUser?.role} open onClose={() => setResultMatch(undefined)} onChanged={async () => { await Promise.all([mutateMatches(), mutateOverview(), mutateReadiness()]); }} />}
    </div>
  );
}

function ResultWorkflowModal({ match, role, open, onClose, onChanged }: { match: any; role?: string; open: boolean; onClose: () => void; onChanged: () => Promise<void> }) {
  const { message, modal } = AntApp.useApp();
  const [form] = Form.useForm();
  const [pending, setPending] = useState(false);
  const { data, mutate } = useSWR<any>(`/results/matches/${match.id}`, fetcher);
  const state = data?.resultStatus || match.resultStatus || 'DRAFT';
  const athletes = useMemo(() => [match.athlete1, match.athlete2].filter(Boolean), [match]);
  const resultStages = ['DRAFT', 'ENTERED', 'REFEREE_CONFIRMED', 'APPROVED', 'PUBLISHED', 'LOCKED'];
  const isAdmin = role === 'ADMIN';
  const canEnter = isAdmin || ['GAMES_ADMIN'].includes(role || '');
  const canConfirm = isAdmin || ['GAMES_ADMIN'].includes(role || '');
  const canApprove = isAdmin || ['GAMES_ADMIN'].includes(role || '');

  const act = async (action: string, payload: Record<string, unknown> = {}) => {
    setPending(true);
    try {
      await api.post(`/results/matches/${match.id}/${action}`, {
        ...payload,
        expectedVersion: data?.resultVersion ?? match.resultVersion ?? 0,
      });
      message.success('Đã cập nhật quy trình kết quả');
      await Promise.all([mutate(), onChanged()]);
    } catch (error: any) {
      message.error(requestMessage(error, 'Không thể cập nhật kết quả'));
    } finally {
      setPending(false);
    }
  };

  const enter = async () => {
    try { await act('enter', await form.validateFields()); }
    catch (error: any) { if (!error?.errorFields) message.error(requestMessage(error, 'Dữ liệu chưa hợp lệ')); }
  };
  const nextAction = state === 'ENTERED' ? { action: 'referee-confirm', label: 'Trọng tài xác nhận', allowed: canConfirm } : state === 'REFEREE_CONFIRMED' ? { action: 'approve', label: 'Phê duyệt', allowed: canApprove } : state === 'APPROVED' ? { action: 'publish', label: 'Công bố', allowed: canApprove } : state === 'PUBLISHED' ? { action: 'lock', label: 'Khóa kết quả', allowed: canApprove } : null;

  const confirmReopen = () => {
    let reason = '';
    modal.confirm({
      title: 'Mở lại kết quả để hiệu chỉnh?',
      content: <Input.TextArea className="mt-3" rows={3} placeholder="Bắt buộc nhập lý do mở lại" onChange={(event) => { reason = event.target.value; }} />,
      okText: 'Mở lại',
      cancelText: 'Hủy',
      okButtonProps: { danger: true },
      onOk: async () => {
        if (!reason.trim()) {
          message.error('Vui lòng nhập lý do mở lại');
          throw new Error('Reason is required');
        }
        await act('reopen', { reason: reason.trim() });
      },
    });
  };

  return (
    <Modal
      title={`Quy trình kết quả · Trận #${match.matchNumber || '—'}`}
      open={open}
      onCancel={onClose}
      footer={null}
      width={920}
      centered
      destroyOnHidden
    >
      <Space direction="vertical" size="large" className="w-full">
        <Steps
          size="small"
          responsive
          current={Math.max(0, resultStages.indexOf(state))}
          items={resultStages.map((status) => ({
            title: resultLabels[status].shortLabel || resultLabels[status].label,
          }))}
        />
        <ToastNotice
          showIcon
          type={state === 'LOCKED' ? 'success' : 'info'}
          message={resultLabels[state]?.label || 'Chưa xác định trạng thái'}
          description={state === 'LOCKED' ? 'Kết quả đã được chốt và không thể sửa nếu chưa mở lại.' : undefined}
        />
        {(state === 'DRAFT' || state === 'ENTERED') && <Form form={form} layout="vertical" disabled={!canEnter} initialValues={{ athlete1Score: data?.athlete1Score ?? match.athlete1Score ?? 0, athlete2Score: data?.athlete2Score ?? match.athlete2Score ?? 0, winnerId: data?.winnerId || match.winnerId }}><Row gutter={12}><Col span={12}><Form.Item name="athlete1Score" label={`Điểm ${match.athlete1?.fullName || 'VĐV 1'}`}><InputNumber className="w-full" /></Form.Item></Col><Col span={12}><Form.Item name="athlete2Score" label={`Điểm ${match.athlete2?.fullName || 'VĐV 2'}`}><InputNumber className="w-full" /></Form.Item></Col></Row><Form.Item name="winnerId" label="Người thắng"><Select allowClear options={athletes.map((athlete: any) => ({ value: athlete.id, label: athlete.fullName }))} /></Form.Item>{state === 'ENTERED' && <Form.Item name="reason" label="Lý do hiệu chỉnh" rules={[{ required: true }]}><Input.TextArea rows={2} /></Form.Item>}<Button type="primary" disabled={!canEnter} loading={pending} onClick={enter}>Lưu kết quả</Button></Form>}
        <Space wrap>{nextAction && <Button type="primary" icon={<CheckCircle2 className="h-4 w-4" />} disabled={!nextAction.allowed} loading={pending} onClick={() => act(nextAction.action)}>{nextAction.label}</Button>}{isAdmin && state !== 'DRAFT' && state !== 'ENTERED' && <Button danger icon={<LockKeyhole className="h-4 w-4" />} loading={pending} onClick={confirmReopen}>Mở lại để hiệu chỉnh</Button>}</Space>
        <Card size="small" title="Lịch sử thay đổi">
          <Table
            rowKey="id"
            size="small"
            dataSource={data?.resultRevisions || []}
            pagination={(data?.resultRevisions || []).length > 8 ? { pageSize: 8, hideOnSinglePage: true } : false}
            scroll={{ x: 760 }}
            locale={{ emptyText: 'Chưa có thay đổi nào.' }}
            columns={[
              { title: 'Phiên bản', dataIndex: 'version', width: 90 },
              {
                title: 'Thao tác',
                dataIndex: 'action',
                width: 190,
                render: (value: string) => labelOf(RESULT_ACTION_LABELS, value, 'Cập nhật kết quả'),
              },
              {
                title: 'Trạng thái sau thay đổi',
                dataIndex: 'status',
                width: 180,
                render: (value: string) => {
                  const item = statusMeta(RESULT_STATUS_META, value);
                  return <Tag color={item.color}>{item.label}</Tag>;
                },
              },
              {
                title: 'Thời gian',
                dataIndex: 'createdAt',
                width: 180,
                render: (value: string) => dayjs(value).format('DD/MM/YYYY HH:mm:ss'),
              },
              { title: 'Lý do', dataIndex: 'reason', render: (value: string) => value || '—' },
            ]}
          />
        </Card>
      </Space>
    </Modal>
  );
}
