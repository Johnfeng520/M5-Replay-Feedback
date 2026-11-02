# 主体界面主题

资源来自用户提供的《华丽风UI合集.rar》，21张原PNG按原字节保留，SHA256见assets/ornate/manifest.json。

theme.css集中管理颜色、字体相关颜色、九宫格面板、主按钮三态和复选框；stage.css管理应用外壳、登录与工作台布局，author.css/player.css管理各自页面。界面素材通过Vite导入/相对url打包，构建后自动带内容哈希。

主面板使用uibitmap；内嵌面板使用uicomboboxbg；主按钮对应btn_normal/over/click；导航使用tab_unselected/selected；复选框使用check_unselected/selected。九宫格切片保留边角，内容区可以随文本伸长。小型删除/工具按钮保持简洁描边，画布操作键保留原行为。

UI素材与剧情素材分开：不得把这些按钮PNG写入Story的media字段或fixtures/assets/catalog.json，也不得因换界面主题改变已发布剧情摘要。现有Story/Layout/规则/API/数据库不依赖主题；正文、道具、选项、存档仍从真实数据读取。

未新增故事背景、角色图、音乐或动画。原资源包未附授权文件，保留来源记录，不擅自填写许可。后续公共发布前按实际取得的授权补充记录。
