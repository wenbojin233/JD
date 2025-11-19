import { useState } from 'react';
import { Bell, Menu, X, Settings, BarChart3, Package, Users, FileText, Zap, HomeIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface MaterialPool {
  id: string;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  status: 'active' | 'inactive';
}

interface Task {
  id: string;
  name: string;
  category: string;
  progress: number;
  status: 'pending' | 'in_progress' | 'completed';
  dueDate: string;
}

export default function AdminDashboard() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState('materials');

  // Mock data
  const materialPools: MaterialPool[] = [
    { id: '1', name: '我的物料池-1', category: '原材料', quantity: 1000, unit: '件', status: 'active' },
    { id: '2', name: '我的物料池-2', category: '零部件', quantity: 500, unit: '个', status: 'active' },
    { id: '3', name: '我的物料池-3', category: '半成品', quantity: 200, unit: '套', status: 'active' },
    { id: '4', name: '我的物料池-4', category: '成品', quantity: 100, unit: '件', status: 'active' },
    { id: '5', name: '我的物料池-5', category: '原材料', quantity: 800, unit: '吨', status: 'active' },
    { id: '6', name: '我的物料池-6', category: '零部件', quantity: 300, unit: '个', status: 'inactive' },
  ];

  const tasks: Task[] = [
    { id: '1', name: '同品识别任务-1', category: '识别', progress: 80, status: 'in_progress', dueDate: '2024-12-20' },
    { id: '2', name: '同品识别任务-2', category: '识别', progress: 100, status: 'completed', dueDate: '2024-12-15' },
    { id: '3', name: '同品识别任务-3', category: '识别', progress: 45, status: 'in_progress', dueDate: '2024-12-25' },
    { id: '4', name: '同品识别任务-4', category: '识别', progress: 0, status: 'pending', dueDate: '2024-12-30' },
    { id: '5', name: '同品识别任务-5', category: '识别', progress: 60, status: 'in_progress', dueDate: '2024-12-22' },
    { id: '6', name: '同品识别任务-6', category: '识别', progress: 90, status: 'in_progress', dueDate: '2024-12-18' },
    { id: '7', name: '同品识别任务-7', category: '识别', progress: 30, status: 'in_progress', dueDate: '2024-12-28' },
  ];

  const sidebarItems = [
    { icon: HomeIcon, label: '首页', active: true },
    { icon: BarChart3, label: '数据分析', active: false },
    { icon: Package, label: '物料管理', active: false },
    { icon: Users, label: '用户管理', active: false },
    { icon: FileText, label: '报告', active: false },
    { icon: Zap, label: '设置', active: false },
  ];

  return (
    <div className="flex h-screen" style={{
      background: 'linear-gradient(135deg, #f9fafb 0%, #f3f4f6 50%, #eff2f5 100%)',
    }}>
      {/* Sidebar */}
      <div
        className={`${
          sidebarOpen ? 'w-20' : 'w-0'
        } overflow-hidden flex flex-col items-center py-6 gap-4 transition-all duration-300`}
        style={{
          background: 'linear-gradient(180deg, rgba(255,255,255,0.95) 0%, rgba(248,249,250,0.9) 100%)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.08)',
          backdropFilter: 'blur(10px)',
          borderRight: '1px solid rgba(255,255,255,0.4)',
        }}
      >
        {/* Logo */}
        <div 
          className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-lg shadow-lg flex-shrink-0"
          style={{
            background: 'linear-gradient(135deg, #FF6B6B 0%, #E85555 100%)',
          }}
        >
          JD
        </div>

        {/* Navigation Icons */}
        <nav className="flex flex-col gap-3 flex-1">
          {sidebarItems.map((item, idx) => (
            <button
              key={idx}
              className={`sidebar-icon ${
                item.active ? 'sidebar-icon-active' : 'sidebar-icon-inactive'
              }`}
              title={item.label}
            >
              <item.icon className="w-5 h-5" />
            </button>
          ))}
        </nav>

        {/* User Profile */}
        <button className="sidebar-icon sidebar-icon-inactive">
          <Users className="w-5 h-5" />
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Top Navigation */}
        <div 
          className="px-8 py-4 flex items-center justify-between"
          style={{
            background: 'linear-gradient(90deg, rgba(255,255,255,0.95) 0%, rgba(248,249,250,0.9) 100%)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
            backdropFilter: 'blur(10px)',
            borderBottom: '1px solid rgba(255,255,255,0.4)',
          }}
        >
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 rounded-lg"
              style={{
                background: 'rgba(243,244,246,0.6)',
              }}
            >
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">当前物料池:</span>
              <select className="rounded-lg px-3 py-2 text-sm focus:outline-none"
                style={{
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.8) 0%, rgba(248,249,250,0.7) 100%)',
                  border: '1px solid rgba(255,255,255,0.3)',
                }}
              >
                <option>我的物料池</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button className="p-2 rounded-lg" style={{ background: 'rgba(243,244,246,0.6)' }}>
              <Bell className="w-5 h-5 text-gray-600" />
            </button>
            <button className="tech-button">
              新增
            </button>
            <button className="p-2 rounded-lg" style={{ background: 'rgba(243,244,246,0.6)' }}>
              <Settings className="w-5 h-5 text-gray-600" />
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-auto p-8">
          {/* Tabs */}
          <div className="flex gap-8 mb-8 border-b border-gray-200/50">
            <button
              onClick={() => setActiveTab('materials')}
              className={`pb-3 font-medium text-sm ${
                activeTab === 'materials'
                  ? 'text-[#FF6B6B] border-b-2 border-[#FF6B6B]'
                  : 'text-gray-600'
              }`}
            >
              物料池
            </button>
            <button
              onClick={() => setActiveTab('tasks')}
              className={`pb-3 font-medium text-sm ${
                activeTab === 'tasks'
                  ? 'text-[#FF6B6B] border-b-2 border-[#FF6B6B]'
                  : 'text-gray-600'
              }`}
            >
              任务
            </button>
          </div>

          {/* Materials Grid */}
          {activeTab === 'materials' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {materialPools.map((pool) => (
                <div
                  key={pool.id}
                  className="glass-card p-6"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="font-semibold text-gray-900 mb-1">{pool.name}</h3>
                      <p className="text-sm text-gray-500">{pool.category}</p>
                    </div>
                    <button className="p-1 rounded-lg" style={{ background: 'rgba(243,244,246,0.5)' }}>
                      <span className="text-gray-400">⋮</span>
                    </button>
                  </div>

                  <div className="space-y-3 mb-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">数量:</span>
                      <span className="font-medium text-gray-900">
                        {pool.quantity} {pool.unit}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">状态:</span>
                      <span
                        className="px-2 py-1 rounded-lg text-xs font-medium"
                        style={{
                          background: pool.status === 'active' 
                            ? 'linear-gradient(135deg, rgba(34,197,94,0.15) 0%, rgba(34,197,94,0.08) 100%)'
                            : 'linear-gradient(135deg, rgba(107,114,128,0.15) 0%, rgba(107,114,128,0.08) 100%)',
                          color: pool.status === 'active' ? '#15803d' : '#4b5563',
                        }}
                      >
                        {pool.status === 'active' ? '活跃' : '停用'}
                      </span>
                    </div>
                  </div>

                  <button 
                    className="w-full py-2 rounded-lg text-sm font-medium"
                    style={{
                      background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(59, 130, 246, 0.08) 100%)',
                      color: '#3b82f6',
                    }}
                  >
                    查看详情
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Tasks Grid */}
          {activeTab === 'tasks' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className="glass-card p-6"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="font-semibold text-gray-900 mb-1">{task.name}</h3>
                      <p className="text-sm text-gray-500">{task.category}</p>
                    </div>
                    <button className="p-1 rounded-lg" style={{ background: 'rgba(243,244,246,0.5)' }}>
                      <span className="text-gray-400">⋮</span>
                    </button>
                  </div>

                  <div className="space-y-3 mb-4">
                    <div>
                      <div className="flex justify-between text-sm mb-2">
                        <span className="text-gray-600">进度</span>
                        <span className="font-medium text-gray-900">{task.progress}%</span>
                      </div>
                      <div className="w-full rounded-full h-2 overflow-hidden" style={{
                        background: 'linear-gradient(90deg, rgba(107,114,128,0.2) 0%, rgba(107,114,128,0.1) 100%)',
                      }}>
                        <div
                          className="h-2 rounded-full"
                          style={{ 
                            width: `${task.progress}%`,
                            background: 'linear-gradient(90deg, #FF6B6B 0%, #E85555 100%)',
                          }}
                        />
                      </div>
                    </div>

                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">截止日期:</span>
                      <span className="text-gray-900">{task.dueDate}</span>
                    </div>
                  </div>

                  <button 
                    className="w-full py-2 rounded-lg text-sm font-medium"
                    style={{
                      background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(59, 130, 246, 0.08) 100%)',
                      color: '#3b82f6',
                    }}
                  >
                    查看详情
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
